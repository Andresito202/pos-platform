import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionClaims,
} from "@pos-platform/contracts";
import { LocalChannelAuthenticator, LocalChannelClient } from "@pos-platform/local-channel";
import { loadOrCreateWindowsLocalChannelSecret } from "../src/channel/secret.js";
import { unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";

const IDS = {
  installationId: "018f0000-0000-7000-8000-0000000000a2",
  deviceId: "018f0000-0000-7000-8000-0000000000a3",
  userId: "018f0000-0000-7000-8000-0000000000a1",
  tenantId: "018f0000-0000-7000-8000-0000000000a4",
  companyId: "018f0000-0000-7000-8000-0000000000a5",
  branchId: "018f0000-0000-7000-8000-0000000000a6",
};

function sessionAssertion(operational: ReturnType<typeof generateKeyPairSync>): {
  claims: SessionAssertionClaims;
  signature: string;
} {
  const claims: SessionAssertionClaims = {
    session_id: "018f0000-0000-7000-8000-0000000000b0",
    user_id: IDS.userId,
    tenant_membership_id: "018f0000-0000-7000-8000-0000000000b1",
    installation_id: IDS.installationId,
    device_id: IDS.deviceId,
    issued_at: "2026-09-17T00:00:00.000Z",
    offline_valid_until: "2026-09-18T00:00:00.000Z",
    sequence: 1,
    key_id: "ssa-runtime-01",
  };
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionBytes(claims), operational.privateKey).toString("base64url"),
  };
}

function trustArtifact(root: ReturnType<typeof generateKeyPairSync>, operational: ReturnType<typeof generateKeyPairSync>, version: number, status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED") {
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: "ssa-runtime-01",
    key_purpose: "SESSION_ASSERTION",
    environment: "production",
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
    status,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  });
  return SessionAssertionTrustBundleSchema.parse({
    version,
    keys: [{
      claims,
      signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url"),
    }],
  });
}

async function waitForRuntime(child: ChildProcessWithoutNullStreams): Promise<{ endpoint: string; sessionTrust: string }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("POS Local Service did not reach runtime.started")), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (const line of buffer.split("\n")) {
        if (!line.includes("runtime.started")) continue;
        try {
          const record = JSON.parse(line) as {
            message?: string;
            fields?: { local_channel_endpoint?: string; session_trust?: string };
          };
          if (record.message !== "runtime.started" || record.fields?.local_channel_endpoint === undefined) continue;
          clearTimeout(timer);
          resolve({
            endpoint: record.fields.local_channel_endpoint,
            sessionTrust: record.fields.session_trust ?? "",
          });
          return;
        } catch {
          // Continue buffering until the structured logger emits a complete line.
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`POS Local Service exited before runtime.started: ${String(code)}`));
    });
  });
}

function spawnService(serviceRoot: string, dataDirectory: string, rootPublicKeyPem: string, artifactPath: string): ChildProcessWithoutNullStreams {
  const tsxCli = join(serviceRoot, "node_modules", "tsx", "dist", "cli.mjs");
  return spawn(process.execPath, [tsxCli, "src/main.ts"], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      POS_DATA_DIRECTORY: dataDirectory,
      POS_INSTALLATION_ID: IDS.installationId,
      POS_DEVICE_ID: IDS.deviceId,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: IDS.tenantId,
      POS_COMPANY_ID: IDS.companyId,
      POS_BRANCH_ID: IDS.branchId,
      POS_SESSION_TRUST_ENVIRONMENT: "production",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_ARTIFACT_PATH: artifactPath,
    },
  }) as ChildProcessWithoutNullStreams;
}
describe.skipIf(process.platform !== "win32")("G1.2 main runtime bootstrap", () => {
  it("boots the real service, activates through the real named pipe, recovers after restart and honors trust revocation", async () => {
    const root = generateKeyPairSync("ed25519");
    const operational = generateKeyPairSync("ed25519");
    const dataDirectory = mkdtempSync(join(process.env.TEMP ?? process.cwd(), "camacho-g12-runtime-"));
    const artifactPath = join(dataDirectory, "session-trust.json");
    const serviceRoot = join(import.meta.dirname, "..");
    const channelSecret = loadOrCreateWindowsLocalChannelSecret(dataDirectory, IDS.installationId);
    const clientAuthenticator = new LocalChannelAuthenticator(channelSecret);
    channelSecret.fill(0);
    let service: ChildProcessWithoutNullStreams | undefined;
    let client: LocalChannelClient | undefined;

    try {
      writeFileSync(artifactPath, JSON.stringify(trustArtifact(root, operational, 1, "ACTIVE")), "utf8");
      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const ready = await waitForRuntime(service);
      expect(ready.sessionTrust).toBe("VALID");

      client = new LocalChannelClient(ready.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });

      const assertion = sessionAssertion(operational);
      const activate = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.activate",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { session_assertion: assertion },
      }) as { status: string };
      expect(activate.status).toBe("SUCCEEDED");

      await client.close();
      const stopped = new Promise<void>((resolve) => service!.once("exit", () => resolve()));
      service.kill("SIGTERM");
      await stopped;
      service = undefined;

      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const restarted = await waitForRuntime(service);
      expect(restarted.sessionTrust).toBe("VALID");
      client = new LocalChannelClient(restarted.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });

      const recovered = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.recover",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {},
      }) as { status: string };
      expect(recovered.status).toBe("SUCCEEDED");

      await client.close();
      const stoppedAgain = new Promise<void>((resolve) => service!.once("exit", () => resolve()));
      service.kill("SIGTERM");
      await stoppedAgain;
      service = undefined;

      writeFileSync(artifactPath, JSON.stringify(trustArtifact(root, operational, 2, "REVOKED")), "utf8");
      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const revoked = await waitForRuntime(service);
      expect(revoked.sessionTrust).toBe("INVALID");

      client = new LocalChannelClient(revoked.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });
      const rejected = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.activate",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { session_assertion: assertion },
      }) as { status: string };
      expect(rejected.status).toBe("REJECTED");
    } finally {
      await client?.close().catch(() => undefined);
      if (service !== undefined && service.exitCode === null) service.kill("SIGTERM");
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  }, { timeout: 60_000 });
});
