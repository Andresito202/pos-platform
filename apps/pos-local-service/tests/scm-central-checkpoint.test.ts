import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { windowsScmCheckpointSigningBytes, type WindowsScmHandoffProvision } from "@pos-platform/contracts";
import { windowsScmPolicySigningBytes } from "@pos-platform/local-channel";
import { ScmCentralCheckpointGuard } from "../src/channel/scm-central-checkpoint.js";
import { WindowsScmChannelTransport } from "../src/channel/windows-scm-transport.js";
import type { LocalDatabase } from "@pos-platform/database-sqlite";

const installation = "019a0000-0000-7000-8000-000000000001", device = "019a0000-0000-7000-8000-000000000002";
function scenario() {
  const pair = generateKeyPairSync("ed25519"), publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const pin = createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const from = new Date(Date.now() - 10000).toISOString(), until = new Date(Date.now() + 3600000).toISOString();
  const service = { role: "SERVICE", signer_private_file: "C:\\managed\\signer", signer_spki_sha256: "f".repeat(64), handoff: { installation_id: installation, device_id: device, revision: 1, poll_ms: 100, policy_reference: "SCM_TEST_ONLY" } } as WindowsScmHandoffProvision;
  const candidate = Buffer.from(JSON.stringify({ service })), digest = createHash("sha256").update(candidate).digest("hex");
  const checkpoint = { profile: "CAMACHO_SCM_POLICY_TRUST_V1" as const, service_id: "CamachoPOSLocalService" as const, installation_id: installation, device_id: device, not_before: from, expires_at: until, trust_revision: 1, authority_public_key_pem: publicPem, authority_spki_sha256: pin, current_policy_revision: 1, current_candidate_sha256: digest, revoked_policy_ids: [] as string[], revoked_authority_pins: [] as string[] };
  const policy = { profile: "CAMACHO_SCM_PROVISION_POLICY_V1" as const, service_id: "CamachoPOSLocalService" as const, installation_id: installation, device_id: device, not_before: from, expires_at: until, policy_id: "019a0000-0000-7000-8000-000000000003", trust_revision: 1, policy_revision: 1, authority_spki_sha256: pin, action: "RECOVER_CANDIDATE" as const, candidate_sha256: digest, previous_candidate_sha256: null, policy_reference: "SCM_TEST_ONLY" };
  const provision = { origin: "https://central.example.invalid", root_public_key_pem: publicPem, root_spki_sha256: pin, candidate_file: "C:\\managed\\candidate-pair.json", policy: { policy, signature: sign(null, windowsScmPolicySigningBytes(policy), pair.privateKey).toString("base64url") } };
  const envelope = (value = checkpoint) => ({ checkpoint: value, signature: sign(null, windowsScmCheckpointSigningBytes(value), pair.privateKey).toString("base64url") });
  let stored: Buffer | undefined;
  const store = { has: () => stored !== undefined, read: () => Buffer.from(stored!), write: vi.fn((_key: string, bytes: Buffer) => { stored = Buffer.from(bytes); }) };
  const credentials = { authorization: vi.fn(async () => "DeviceProof test-only") };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(envelope()), { status: 200 }));
  const guard = new ScmCentralCheckpointGuard(provision, service, credentials, store, () => Buffer.from(candidate), fetcher);
  return { guard, service, provision, checkpoint, envelope, store, credentials, fetcher, candidate };
}
afterEach(() => vi.useRealTimers());

describe("SCM live Central checkpoint consumer", () => {
  it("requires live publication, signs the exact request and persists a floor", async () => {
    const s = scenario(); expect(() => s.guard.assertCurrent()).toThrow("SCM_CENTRAL_AUTHORITY_REQUIRED");
    await s.guard.start(() => undefined);
    expect(s.credentials.authorization).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/v1/scm/checkpoint", body: "{}" }));
    expect(s.fetcher).toHaveBeenCalledWith("https://central.example.invalid/v1/scm/checkpoint", expect.objectContaining({ redirect: "error", body: "{}" }));
    expect(s.store.write).toHaveBeenCalledOnce(); expect(() => s.guard.assertCurrent()).not.toThrow();
    await s.guard.stop(); expect(() => s.guard.assertCurrent()).toThrow();
  });
  it.each(["bad signature", "wrong scope", "oversize", "offline", "wrong candidate"])("fails closed: %s", async failure => {
    const s = scenario();
    if (failure === "bad signature") s.fetcher.mockResolvedValue(new Response(JSON.stringify({ ...s.envelope(), signature: "A".repeat(86) })));
    if (failure === "wrong scope") s.fetcher.mockResolvedValue(new Response(JSON.stringify(s.envelope({ ...s.checkpoint, device_id: installation }))));
    if (failure === "oversize") s.fetcher.mockResolvedValue(new Response(" ".repeat(65537)));
    if (failure === "offline") s.fetcher.mockRejectedValue(Error("NETWORK_FAILED"));
    if (failure === "wrong candidate") s.candidate.fill(32);
    await expect(s.guard.start(() => undefined)).rejects.toThrow();
    expect(() => s.guard.assertCurrent()).toThrow(); await s.guard.stop();
  });
  it("persists revocation before stopping; cached state cannot restore admission", async () => {
    vi.useFakeTimers(); const s = scenario(), fault = vi.fn();
    await s.guard.start(fault);
    s.fetcher.mockImplementation(async () => new Response(JSON.stringify(s.envelope({ ...s.checkpoint, trust_revision: 2, revoked_policy_ids: [s.provision.policy.policy.policy_id] }))));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fault).toHaveBeenCalledOnce(); expect(() => s.guard.assertCurrent()).toThrow();
    expect(JSON.parse(s.store.read().toString()).checkpoint.trust_revision).toBe(2);
    await s.guard.stop();
    const restarted = new ScmCentralCheckpointGuard(s.provision, s.service, s.credentials, s.store, () => Buffer.from(s.candidate), async () => new Response(JSON.stringify(s.envelope())));
    await expect(restarted.start(() => undefined)).rejects.toThrow("SCM_CHECKPOINT_ROLLBACK");
    await restarted.stop();
  });
  it("network failure invalidates previously accepted authority", async () => {
    vi.useFakeTimers(); const s = scenario(), fault = vi.fn(); await s.guard.start(fault);
    s.fetcher.mockRejectedValue(Error("NETWORK_FAILED")); await vi.advanceTimersByTimeAsync(5000);
    expect(fault).toHaveBeenCalledOnce(); expect(() => s.guard.assertCurrent()).toThrow(); await s.guard.stop();
  });
  it("a failed durable write never admits the transport", async () => {
    const s = scenario(); s.store.write.mockImplementation(() => { throw Error("DISK_FAILED"); });
    await expect(s.guard.start(() => undefined)).rejects.toThrow("DISK_FAILED"); expect(() => s.guard.assertCurrent()).toThrow(); await s.guard.stop();
  });
  it("Central revocation destroys Electron sockets and stops native admission", async () => {
    const s = scenario(); let revoke!: () => void, rejectAccept!: (error: Error) => void;
    const nativeStop = vi.fn(() => rejectAccept(Error("STOPPED")));
    const guard = { start: async (fault: () => void) => { revoke = fault; }, assertCurrent: vi.fn(), stop: vi.fn(async () => undefined) };
    const transport = new WindowsScmChannelTransport(s.service, {} as LocalDatabase, Buffer.alloc(32, 1), { adapter: { listen: () => ({}), accept: () => new Promise((_resolve, reject) => { rejectAccept = reject; }), stop: nativeStop, connect: async () => { throw Error("UNUSED"); } }, seal: () => { throw Error("UNUSED"); } }, guard);
    await transport.start(() => undefined);
    const socket = new Socket(); const destroyed = vi.spyOn(socket, "destroy");
    (transport as unknown as { sockets: Set<Socket> }).sockets.add(socket);
    revoke(); await transport.stop();
    expect(destroyed).toHaveBeenCalled(); expect(nativeStop).toHaveBeenCalledOnce(); expect(guard.stop).toHaveBeenCalledOnce();
    await expect(transport.start(() => undefined)).rejects.toThrow("SCM_TRANSPORT_STOPPED");
  });
});
