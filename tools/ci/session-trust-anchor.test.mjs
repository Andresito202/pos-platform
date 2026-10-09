import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicKeyPath = resolve(repositoryRoot, "infra/trust/camacho-pos-session-trust-root-public.pub");
const fingerprintPath = resolve(repositoryRoot, "infra/trust/camacho-pos-session-trust-root-public.sha256");

test("session trust root is public Ed25519 material matching the pinned SHA-256 fingerprint", () => {
  const pem = readFileSync(publicKeyPath, "utf8");
  const expectedFingerprint = readFileSync(fingerprintPath, "utf8").trim();

  assert.ok(pem.startsWith("-----BEGIN PUBLIC KEY-----\n"));
  assert.ok(pem.endsWith("-----END PUBLIC KEY-----\n"));
  assert.doesNotMatch(pem, /PRIVATE KEY/);
  assert.match(expectedFingerprint, /^[0-9a-f]{64}$/);

  const key = createPublicKey(pem);
  assert.equal(key.type, "public");
  assert.equal(key.asymmetricKeyType, "ed25519");

  const der = key.export({ type: "spki", format: "der" });
  const actualFingerprint = createHash("sha256").update(der).digest("hex");
  assert.equal(actualFingerprint, expectedFingerprint);
});
