import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unsignedSessionAssertionOperationalKeyBytes, uuidV7, type SessionAssertionOperationalKeyClaims } from "@pos-platform/contracts";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../src/security/insecure-derived-key-provider.js";
import { SessionTrustKeyStore } from "../src/security/session-trust-key-store.js";
import { SessionTrustKeyVerifier } from "../src/security/session-trust-key-verifier.js";
import { SessionTrustKeyResolver } from "../src/security/session-trust-key-resolver.js";
import { SessionTrustRefreshComponent } from "../src/security/session-trust-refresh-component.js";
import { SessionAssertionVerifier, unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";

describe("root trust lifecycle composition (no commercial login)", () => {
  it("outage does not extend key validity; restart stays closed until authenticated rotation", async () => {
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-lifecycle-test-"));
    const root = generateKeyPairSync("ed25519"), old = generateKeyPairSync("ed25519"), next = generateKeyPairSync("ed25519");
    let now = new Date("2026-10-24T12:00:00.000Z");
    const initial = now.getTime();
    const key = (id: string, pair: typeof old, status: SessionAssertionOperationalKeyClaims["status"], until: string) => {
      const claims: SessionAssertionOperationalKeyClaims = {
        key_id: id, key_purpose: "SESSION_ASSERTION", environment: "test", status,
        public_key_pem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
        valid_from: new Date(initial - 1000).toISOString(), valid_until: until, version: 1,
      };
      return { claims, signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url") };
    };
    try {
      const encrypted = () => new EncryptedFileSecretStore(temp, new InsecureDerivedKeyProvider(temp), "lifecycle-test-only");
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "test", () => now);
      const store = new SessionTrustKeyStore(encrypted());
      const resolver = new SessionTrustKeyResolver(store, verifier);
      store.install({ version: 1, keys: [key("old", old, "ACTIVE", new Date(initial + 1000).toISOString())] }, verifier);
      const live = new Map(resolver.resolve().keys);
      let remote: unknown;
      const refresh = new SessionTrustRefreshComponent(async () => {
        if (!remote) throw Error("NETWORK_UNAVAILABLE"); return remote;
      }, (artifact) => resolver.resolveWithArtifact(artifact), live, () => undefined);
      const binding = { userId: uuidV7(), installationId: uuidV7(), deviceId: uuidV7() };
      const claims = {
        session_id: uuidV7(), user_id: binding.userId, tenant_membership_id: uuidV7(),
        installation_id: binding.installationId, device_id: binding.deviceId,
        issued_at: now.toISOString(), offline_valid_until: new Date(initial + 10_000).toISOString(), sequence: 1, key_id: "old",
      };
      const ssa = { claims, signature: sign(null, unsignedSessionAssertionBytes(claims), old.privateKey).toString("base64url") };
      const receive = new SessionAssertionVerifier(live, { accept: () => undefined } as never, () => now);
      expect(receive.verify(ssa, binding).decision).toBe("VALID");
      now = new Date(initial + 1000);
      await refresh.refreshNow(); // cached map survives transport loss, validity does not
      expect(live.has("old")).toBe(true);
      expect(receive.verify(ssa, binding).decision).toBe("EXPIRED");
      expect(new SessionTrustKeyResolver(new SessionTrustKeyStore(encrypted()), verifier).resolve().decision).toBe("INVALID");
      remote = { version: 2, keys: [
        key("old", old, "REVOKED", new Date(initial + 1000).toISOString()),
        key("next", next, "ACTIVE", new Date(initial + 20_000).toISOString()),
      ] };
      await refresh.refreshNow();
      expect([...live.keys()]).toEqual(["next"]);
      const newClaims = { ...claims, key_id: "next", sequence: 2 };
      expect(receive.verify({ claims: newClaims, signature: sign(null, unsignedSessionAssertionBytes(newClaims), next.privateKey).toString("base64url") }, binding).decision).toBe("VALID");
      expect(new SessionTrustKeyResolver(new SessionTrustKeyStore(encrypted()), verifier).resolve().decision).toBe("VALID");
      await refresh.stop();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
