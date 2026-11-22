import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { canonicalSessionTrustJson, WindowsScmCentralProvisionSchema, type SignedWindowsScmCheckpoint, type WindowsScmCentralProvision, type WindowsScmHandoffProvision, type WindowsScmPolicyTrust } from "@pos-platform/contracts";
import { readWindowsManagedBytes, verifyWindowsScmCheckpoint, verifyWindowsScmPolicy } from "@pos-platform/local-channel";
import type { DeviceCredentialProvider } from "../sync/device-credential.js";
import type { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";

const PATH = "/v1/scm/checkpoint";
const SECRET = "scm-central-checkpoint";
export interface ScmCheckpointGuard {
  start(fault: () => void): Promise<void>;
  assertCurrent(): void;
  stop(): Promise<void>;
}
export function readScmCentralProvision(file: string): WindowsScmCentralProvision {
  const bytes = readWindowsManagedBytes(file);
  try {
    if (bytes.length > 65536) throw Error("SCM_CENTRAL_PROVISION_REJECTED");
    return WindowsScmCentralProvisionSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } finally { bytes.fill(0); }
}

/** Online authority is mandatory. Persisted state is a rollback floor only;
 * it never serves as a network fallback or as commercial enablement. */
export class ScmCentralCheckpointGuard implements ScmCheckpointGuard {
  private timer: NodeJS.Timeout | undefined;
  private pending: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private current: Readonly<WindowsScmPolicyTrust> | undefined;
  private acceptedAt = -Infinity;
  private stopped = false;
  private faulted = false;
  constructor(
    private readonly provision: WindowsScmCentralProvision,
    private readonly service: WindowsScmHandoffProvision,
    private readonly credentials: DeviceCredentialProvider,
    private readonly store: Pick<EncryptedFileSecretStore, "has" | "read" | "write">,
    private readonly candidateBytes: () => Buffer = () => readWindowsManagedBytes(provision.candidate_file),
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private verify(input: unknown) {
    const h = this.service.handoff, p = this.provision;
    return verifyWindowsScmCheckpoint(input, { publicKeyPem: p.root_public_key_pem, spkiSha256: p.root_spki_sha256, installationId: h.installation_id, deviceId: h.device_id });
  }
  private async refresh(): Promise<void> {
    const requestId = randomUUID(), correlationId = randomUUID(), body = "{}";
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 5000);
    try {
      const authorization = await this.credentials.authorization({ method: "POST", path: PATH, requestId, correlationId, body });
      const response = await this.fetcher(this.provision.origin + PATH, { method: "POST", headers: { authorization, "content-type": "application/json", "x-request-id": requestId, "x-correlation-id": correlationId }, body, redirect: "error", signal: this.controller.signal });
      if (response.status !== 200 || !response.body) throw Error("SCM_CENTRAL_UNAVAILABLE");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 65536) throw Error("SCM_CENTRAL_RESPONSE_TOO_LARGE"); chunks.push(next.value); }
      } finally { await reader.cancel().catch(() => undefined); }
      const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as SignedWindowsScmCheckpoint;
      const trust = this.verify(envelope);
      if (this.stopped) throw Error("SCM_CHECKPOINT_STOPPED");
      if (this.store.has(SECRET)) {
        const saved = this.store.read(SECRET);
        try {
          const old = this.verify(JSON.parse(saved.toString("utf8")));
          if (trust.trust_revision < old.trust_revision ||
              trust.trust_revision === old.trust_revision && canonicalSessionTrustJson(trust) !== canonicalSessionTrustJson(old) ||
              trust.authority_spki_sha256 !== old.authority_spki_sha256 ||
              trust.current_policy_revision < old.current_policy_revision ||
              !old.revoked_policy_ids.every(id => trust.revoked_policy_ids.includes(id)) ||
              !old.revoked_authority_pins.every(pin => trust.revoked_authority_pins.includes(pin))) throw Error("SCM_CHECKPOINT_ROLLBACK");
        } finally { saved.fill(0); }
      }
      // Persist revocations BEFORE policy checks, including when this policy is
      // now revoked. A failed write cannot advance the live authority state.
      const saved = Buffer.from(JSON.stringify(envelope));
      try { this.store.write(SECRET, saved); } finally { saved.fill(0); }
      const policy = verifyWindowsScmPolicy(this.provision.policy, trust);
      const bytes = this.candidateBytes();
      try {
        if (bytes.length > 65536 || createHash("sha256").update(bytes).digest("hex") !== policy.candidate_sha256) throw Error("SCM_CANDIDATE_REJECTED");
        const candidate = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (canonicalSessionTrustJson(candidate.service) !== canonicalSessionTrustJson(this.service)) throw Error("SCM_SERVICE_CANDIDATE_MISMATCH");
      } finally { bytes.fill(0); }
      if (policy.action !== "RECOVER_CANDIDATE" || policy.policy_revision !== this.service.handoff.revision ||
          policy.policy_reference !== this.service.handoff.policy_reference ||
          this.provision.root_spki_sha256 === this.service.signer_spki_sha256) throw Error("SCM_POLICY_BINDING_REJECTED");
      this.current = trust; this.acceptedAt = performance.now();
    } finally { clearTimeout(timeout); this.controller = undefined; }
  }
  async start(fault: () => void): Promise<void> {
    if (this.stopped || this.pending || this.current) throw Error("SCM_CHECKPOINT_ALREADY_STARTED");
    await this.refresh();
    this.timer = setInterval(() => {
      if (this.pending || this.stopped) return;
      this.pending = this.refresh().catch(() => {
        this.faulted = true; this.current = undefined; clearInterval(this.timer); fault();
      }).finally(() => { this.pending = undefined; });
    }, 5000);
    this.timer.unref();
  }
  assertCurrent(): void {
    const t = this.current, now = Date.now();
    if (this.stopped || this.faulted || !t || performance.now() - this.acceptedAt >= 11000 ||
        now < Date.parse(t.not_before) || now >= Date.parse(t.expires_at)) throw Error("SCM_CENTRAL_AUTHORITY_REQUIRED");
  }
  async stop(): Promise<void> {
    this.stopped = true; this.current = undefined; clearInterval(this.timer); this.controller?.abort(); await this.pending;
  }
}
