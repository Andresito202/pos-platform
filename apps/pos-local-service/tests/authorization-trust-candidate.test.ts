import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { unsignedAuthorizationTrustCandidateBytes, canonicalSessionTrustJson, type AuthorizationTrustCandidateClaims } from "@pos-platform/contracts";
import { EncryptedFileSecretStore } from "../src/security/encrypted-secret-store.js";
import { WindowsDpapiKeyProvider } from "../src/security/windows-dpapi-key-provider.js";
import { TrustedClockGuard } from "../src/security/trusted-clock.js";
import { AuthorizationTrustCandidateStore } from "../src/security/authorization-trust-candidate.js";
import { refreshIsolatedAuthorizationTrust } from "../src/security/isolated-authorization-trust-fetcher.js";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { TrustedSigningKey } from "../src/security/license-verifier.js";

const io = vi.hoisted(() => ({ failRename: false }));
vi.mock("node:fs", async importActual => {
  const real = await importActual<typeof import("node:fs")>();
  return { ...real, renameSync: (...args: Parameters<typeof real.renameSync>) => {
    if (io.failRename) throw Error("INJECTED_RENAME_FAILURE");
    return real.renameSync(...args);
  } };
});
const cleanup: (() => void)[] = [];
afterEach(() => { io.failRename = false; for (const close of cleanup.splice(0)) close(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "camacho-sas-trust-"));
  if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("camacho-sas-trust-"))
    throw Error("SAS_TRUST_TEST_DIRECTORY_REJECTED");
  const db = LocalDatabase.open({ dataDirectory: dir });
  let closed = false;
  const closeDatabase = () => { if (!closed) { db.close(); closed = true; } };
  const root = generateKeyPairSync("ed25519"), key = generateKeyPairSync("ed25519");
  let now = new Date("2026-10-25T12:00:00.000Z");
  const secrets = new EncryptedFileSecretStore(dir, new WindowsDpapiKeyProvider(dir), "dec011-sas-lab-only");
  const ssa = new Map<string, TrustedSigningKey>();
  const policy = { mode: "ISOLATED_VALIDATION", issuer: "https://central.example.test", authorityId: "LAB_ROOT_SAS",
    environment: "isolated-validation", minimumGeneration: 1, root: root.publicKey } as const;
  const create = (secretStore = secrets) => new AuthorizationTrustCandidateStore(secretStore, policy, ssa, new TrustedClockGuard(db, 0), () => now);
  const store = create();
  const claims: AuthorizationTrustCandidateClaims = {
    profile: "DEC011_LAB_CANDIDATE_1", mode: "ISOLATED_VALIDATION", schema_version: 1,
    purpose: "AUTHORIZATION_SNAPSHOT", environment: "isolated-validation", issuer: policy.issuer, authority_id: policy.authorityId,
    generation: 1, complete: true, issued_at: "2026-10-25T11:59:00.000Z", valid_from: "2026-10-25T11:59:00.000Z", valid_until: "2026-10-25T13:00:00.000Z",
    keys: [{ key_id: "SAS_TEST_A", purpose: "AUTHORIZATION_SNAPSHOT", public_key_pem: key.publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "ACTIVE", version: 1, valid_from: "2026-10-25T11:00:00.000Z", valid_until: "2026-10-26T13:00:00.000Z" }],
  };
  const signed = (c = claims, signer = root.privateKey) => ({ claims: structuredClone(c), signature: sign(null, unsignedAuthorizationTrustCandidateBytes(c), signer).toString("base64url") });
  cleanup.push(() => { secrets.destroy(); closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, db, root, key, secrets, ssa, policy, create, store, claims, signed, closeDatabase, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

it.runIf(process.platform === "win32")("SAS candidate: real DPAPI survives provider/store restart and revalidates on every read", () => {
  const f = fixture(); expect(f.secrets.protection).toBe("OS_BOUND"); f.store.install(f.signed());
  const reopened = new EncryptedFileSecretStore(f.dir, new WindowsDpapiKeyProvider(f.dir), "dec011-sas-lab-only");
  try {
    const recovered = f.create(reopened), live = recovered.liveKeys();
    expect(live.get("SAS_TEST_A")?.status).toBe("ACTIVE");
    const corrupt = f.signed(); corrupt.claims.generation = 99;
    reopened.write("authorization-trust-lab-candidate", Buffer.from(JSON.stringify(corrupt)));
    expect(live.size).toBe(0);
  } finally { reopened.destroy(); }
});

it.runIf(process.platform === "win32")("SAS candidate: separate Node process recovers protected generation and rejects downgrade", () => {
  const f = fixture(); f.claims.generation = 2; f.store.install(f.signed());
  f.closeDatabase(); // Canonical single-writer lock must be released before restart.
  const script = `
    import {readFileSync} from 'node:fs';
    import {createPublicKey} from 'node:crypto';
    import {LocalDatabase} from '@pos-platform/database-sqlite';
    import {EncryptedFileSecretStore} from './src/security/encrypted-secret-store.ts';
    import {WindowsDpapiKeyProvider} from './src/security/windows-dpapi-key-provider.ts';
    import {TrustedClockGuard} from './src/security/trusted-clock.ts';
    import {AuthorizationTrustCandidateStore} from './src/security/authorization-trust-candidate.ts';
    const input=JSON.parse(readFileSync(0,'utf8'));
    const db=LocalDatabase.open({dataDirectory:input.directory});
    const secrets=new EncryptedFileSecretStore(input.directory,new WindowsDpapiKeyProvider(input.directory),'dec011-sas-lab-only');
    try {
      const store=new AuthorizationTrustCandidateStore(secrets,{...input.policy,root:createPublicKey(input.publicRoot)},new Map(),new TrustedClockGuard(db,0),()=>new Date('2026-10-25T12:00:00.000Z'));
      let rejected=false;try{store.install(input.old);}catch{rejected=true;}
      process.stdout.write(JSON.stringify({keys:store.resolve().size,rejected}));
    } finally {secrets.destroy();db.close();}
  `;
  const old = structuredClone(f.claims); old.generation = 1;
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    input: JSON.stringify({ directory: f.dir, policy: { ...f.policy, root: undefined },
      publicRoot: f.root.publicKey.export({ type: "spki", format: "pem" }).toString(), old: f.signed(old) }),
    encoding: "utf8", windowsHide: true,
  });
  expect(JSON.parse(output)).toEqual({ keys: 1, rejected: true });
});

it.runIf(process.platform === "win32").each(["root", "generation", "set", "key-id", "revocation", "issuer", "environment", "purpose", "authority", "incomplete"])("SAS candidate: rejects unauthenticated %s without replacing trusted state", target => {
  const f = fixture(); f.store.install(f.signed()); const forged = f.signed();
  if (target === "root") forged.signature = f.signed(f.claims, generateKeyPairSync("ed25519").privateKey).signature;
  if (target === "generation") forged.claims.generation++;
  if (target === "set") forged.claims.keys = [];
  if (target === "key-id") forged.claims.keys[0]!.key_id = "SAS_TEST_SUBSTITUTED";
  if (target === "revocation") forged.claims.keys[0]!.status = "REVOKED";
  if (target === "issuer") forged.claims.issuer = "https://another.example.test";
  if (target === "environment") (forged.claims as Record<string, unknown>).environment = "production";
  if (target === "purpose") (forged.claims as Record<string, unknown>).purpose = "SESSION_ASSERTION";
  if (target === "authority") forged.claims.authority_id = "OTHER_ROOT";
  if (target === "incomplete") (forged.claims as Record<string, unknown>).complete = false;
  expect(() => f.store.install(forged)).toThrow(); expect(f.store.resolve().get("SAS_TEST_A")?.status).toBe("ACTIVE");
});

it.runIf(process.platform === "win32").each(["issuer", "authority", "SSA alias", "private key", "trailing private key", "EC key"])("SAS candidate: even root-signed %s cannot grant trust", target => {
  const f = fixture();
  if (target === "issuer") f.claims.issuer = "https://other.example.test";
  if (target === "authority") f.claims.authority_id = "OTHER_AUTHORITY";
  if (target === "SSA alias") f.ssa.set("OTHER_SSA_ID", { key: f.key.publicKey, status: "ACTIVE" });
  if (target === "private key") f.claims.keys[0]!.public_key_pem = f.key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  if (target === "trailing private key") f.claims.keys[0]!.public_key_pem += f.key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  if (target === "EC key") f.claims.keys[0]!.public_key_pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }).toString();
  const artifact = { claims: f.claims, signature: sign(null, Buffer.from(canonicalSessionTrustJson(f.claims)), f.root.privateKey).toString("base64url") };
  expect(() => f.store.install(artifact)).toThrow(); expect(f.store.resolve().size).toBe(0);
});

it.runIf(process.platform === "win32").each(["omission", "same-id material", "version rollback", "same-version mutation", "revived", "revoked alias", "generation rollback", "generation conflict"])("SAS candidate: signed rotation rejects %s with history retained", target => {
  const f = fixture(); f.claims.keys[0]!.status = "REVOKED"; f.claims.generation = 2; f.claims.keys[0]!.version = 2;
  f.store.install(f.signed()); const next = structuredClone(f.claims); next.generation = 3;
  const another = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  if (target === "omission") next.keys = [{ ...next.keys[0]!, key_id: "SAS_TEST_B", public_key_pem: another }];
  if (target === "same-id material") next.keys[0]!.public_key_pem = another;
  if (target === "version rollback") next.keys[0]!.version = 1;
  if (target === "same-version mutation") next.keys[0]!.valid_until = "2026-10-27T13:00:00.000Z";
  if (target === "revived") { next.keys[0]!.status = "ACTIVE"; next.keys[0]!.version++; }
  if (target === "revoked alias") next.keys.push({ ...next.keys[0]!, key_id: "SAS_TEST_B", status: "ACTIVE" });
  if (target === "generation rollback") next.generation = 1;
  if (target === "generation conflict") { next.generation = 2; next.keys[0]!.version++; }
  expect(() => f.store.install(f.signed(next))).toThrow(); expect(f.store.resolve().get("SAS_TEST_A")?.status).toBe("REVOKED");
});

it.runIf(process.platform === "win32")("SAS candidate: atomic rename failure retains generation and keys across recovery", () => {
  const f = fixture(); f.store.install(f.signed()); const next = structuredClone(f.claims); next.generation++;
  next.keys[0]!.status = "REVOKED"; next.keys[0]!.version++;
  io.failRename = true; expect(() => f.store.install(f.signed(next))).toThrow("INJECTED_RENAME_FAILURE"); io.failRename = false;
  expect(f.create().resolve().get("SAS_TEST_A")?.status).toBe("ACTIVE");
  expect(f.store.install(f.signed(next))).toBe(2); expect(() => f.create().install(f.signed())).toThrow("SAS_GENERATION_ROLLBACK");
});

it.runIf(process.platform === "win32")("SAS candidate: concurrent same-owner rotations retain highest generation and terminal revocation", async () => {
  const f = fixture(); f.store.install(f.signed()); const second = structuredClone(f.claims); second.generation = 2; second.keys[0]!.status = "VERIFY_ONLY"; second.keys[0]!.version++;
  const third = structuredClone(second); third.generation = 3; third.keys[0]!.status = "REVOKED"; third.keys[0]!.version++;
  const results = await Promise.allSettled([third, second].map(c => Promise.resolve().then(() => f.create().install(f.signed(c)))));
  expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(f.store.resolve().get("SAS_TEST_A")?.status).toBe("REVOKED");
});

it.runIf(process.platform === "win32")("SAS candidate: offline expiry denies cached map, accepts fresh renewal preserving tombstones", () => {
  const f = fixture(); f.store.install(f.signed()); const live = f.store.liveKeys();
  expect(live.get("SAS_TEST_A")?.validUntil).toBe(f.claims.valid_until);
  f.advance(3600_000); expect(live.size).toBe(0);
  const next = structuredClone(f.claims); next.generation++; next.valid_until = "2026-10-25T14:00:00.000Z";
  f.store.install(f.signed(next)); expect(live.size).toBe(1);
  f.advance(-3600_000); expect(live.size).toBe(0);
});

it.runIf(process.platform === "win32")("SAS candidate: authenticated rotation adds a distinct key and retained VERIFY_ONLY key still verifies", () => {
  const f = fixture(); f.store.install(f.signed()); const next = structuredClone(f.claims); next.generation++;
  next.keys[0]!.status = "VERIFY_ONLY"; next.keys[0]!.version++;
  next.keys.push({ ...next.keys[0]!, key_id: "SAS_TEST_B", status: "ACTIVE", version: 1,
    public_key_pem: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString() });
  f.store.install(f.signed(next)); const live = f.store.liveKeys();
  expect([...live.keys()]).toEqual(["SAS_TEST_A", "SAS_TEST_B"]);
  expect(live.get("SAS_TEST_A")?.status).toBe("VERIFY_ONLY");
  f.ssa.set("FUTURE_SSA_ALIAS", { key: f.key.publicKey, status: "REVOKED" });
  expect(live.size).toBe(0); // Current SSA trust is checked again at use.
});

it.runIf(process.platform === "win32").each(["expired", "future", "bootstrap floor", "missing policy"])("SAS candidate: %s fails closed", target => {
  const f = fixture();
  if (target === "expired") f.advance(3600_000);
  if (target === "future") f.claims.valid_from = "2026-10-25T12:01:00.000Z";
  if (target === "bootstrap floor") {
    const store = new AuthorizationTrustCandidateStore(f.secrets, { ...f.policy, minimumGeneration: 10 }, f.ssa, new TrustedClockGuard(f.db, 0), () => new Date("2026-10-25T12:00:00.000Z"));
    expect(() => store.install(f.signed())).toThrow("SAS_TRUST_BINDING_REJECTED"); return;
  }
  if (target === "missing policy") {
    expect(() => new AuthorizationTrustCandidateStore(f.secrets, { ...f.policy, mode: "PRODUCTION" } as never, f.ssa, new TrustedClockGuard(f.db, 0), () => new Date())).toThrow(); return;
  }
  expect(() => f.store.install(f.signed())).toThrow(); expect(f.store.resolve().size).toBe(0);
});

it.runIf(process.platform === "win32")("SAS candidate: real HTTPS rejects tampering redirects oversized bodies deadline and offline without replacing durable trust", async () => {
  const f = fixture(); f.store.install(f.signed());
  const keyPath = join(f.dir, "tls.key"), certPath = join(f.dir, "tls.crt");
  execFileSync("C:/Program Files/Git/usr/bin/openssl.exe", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=business.example.test",
    "-addext", "subjectAltName=DNS:business.example.test", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  const ca = readFileSync(certPath, "utf8"); let behavior = "valid";
  const server = createServer({ key: readFileSync(keyPath), cert: ca }, (_req, res) => {
    if (behavior === "timeout") return;
    if (behavior === "redirect") { res.writeHead(302, { location: "https://evil.example.test" }); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    if (behavior === "oversize") { res.end("x".repeat(1024 * 1024 + 1)); return; }
    const artifact = f.signed(); if (behavior === "tamper") artifact.claims.generation++;
    res.end(JSON.stringify(artifact));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("TLS_FIXTURE_REQUIRED");
  const input = { mode: "ISOLATED_VALIDATION" as const, url: `https://business.example.test:${address.port}/v1/isolated/authorization-trust`, ca, timeoutMs: 2000, store: f.store };
  try {
    expect(await refreshIsolatedAuthorizationTrust(input)).toBe(1);
    await expect(refreshIsolatedAuthorizationTrust({ ...input, ca: "not a trusted CA" })).rejects.toThrow();
    await expect(refreshIsolatedAuthorizationTrust({ ...input, url: input.url.replace("authorization-trust", "session-trust") })).rejects.toThrow("SAS_LAB_TRANSPORT_REQUIRED");
    for (behavior of ["tamper", "redirect", "oversize", "timeout"]) {
      await expect(refreshIsolatedAuthorizationTrust({ ...input, timeoutMs: behavior === "timeout" ? 150 : 2000 })).rejects.toThrow();
      expect(f.store.resolve().get("SAS_TEST_A")?.status).toBe("ACTIVE");
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await expect(refreshIsolatedAuthorizationTrust(input)).rejects.toThrow();
  expect(f.create().resolve().size).toBe(1); // Offline only while signed trust is valid.
  f.advance(3600_000); expect(f.create().resolve().size).toBe(0);
});
