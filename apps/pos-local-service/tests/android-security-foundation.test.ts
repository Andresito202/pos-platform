import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceTrustVerifier, unsignedDeviceTrustCredentialBytes, type TrustedDeviceTrustKey } from "@pos-platform/device-trust";
import { SignedDeviceTrustCredentialSchema, type DeviceEnrollmentRequest } from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { AndroidSecurityFoundation, type AndroidLicenseObservation } from "../src/android/android-security-foundation.js";
import { LicenseCapacityGate } from "../src/security/license-capacity-gate.js";
import { unsignedLicenseCapacityBytes } from "../src/security/license-verifier.js";
import { LicenseCapacityClaimsSchema } from "@pos-platform/contracts";
import { AndroidServiceFoundation } from "../src/android/android-service-foundation.js";
import { AndroidKeystoreKeyProvider } from "../src/security/android-keystore-key-provider.js";

// Explicit software fixtures, not Android Keystore attestation or a production authority.
const binding = { tenantId: "018f0000-0000-7000-8000-000000000001", companyId: "018f0000-0000-7000-8000-000000000002", installationId: "018f0000-0000-7000-8000-000000000003", deviceId: "018f0000-0000-7000-8000-000000000004" };
const directories: string[] = [];
const services: AndroidSecurityFoundation[] = [];
const roots: Buffer[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) if (["READY", "FAILED"].includes(service.status().state)) await service.stop();
  for (const root of roots.splice(0)) root.fill(0);
  for (const directory of directories.splice(0)) {
    const target = realpathSync(directory);
    if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith("camacho-android-security-")) throw new Error("TEST_CLEANUP_PATH_REJECTED");
    rmSync(target, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "camacho-android-security-")); directories.push(directory);
  const root = randomBytes(32); roots.push(root);
  const issuer = generateKeyPairSync("ed25519");
  const keys = new Map<string, TrustedDeviceTrustKey>([["TEST_DEVICE_TRUST", { key: issuer.publicKey, status: "ACTIVE", validFrom: "2026-10-22T00:00:00Z" }]]);
  let time = new Date("2026-10-22T12:00:00Z");
  const now = () => time;
  const verifier = new DeviceTrustVerifier(generateKeyPairSync("ed25519").publicKey, keys, { now, accept: () => undefined });
  const build = (seed = root, license?:AndroidLicenseObservation) => {
    const provider = new AndroidKeystoreKeyProvider(seed, "android");
    const runtime = new AndroidSecurityFoundation(directory, binding, provider, verifier, now,license);
    services.push(runtime); return { runtime, provider };
  };
  const activation = {
    activation_id: "018f0000-0000-7000-8000-000000000010", tenant_id: binding.tenantId, company_id: binding.companyId,
    installation_id: binding.installationId, device_id: binding.deviceId, activation_secret: "A".repeat(64),
    status: "ISSUED", issued_at: "2026-10-22T11:00:00Z", expires_at: "2026-10-22T13:00:00Z", version: 1,
  };
  function result(request: DeviceEnrollmentRequest, publicKey = request.device_public_key_pem) {
    const claims = SignedDeviceTrustCredentialSchema.shape.claims.parse({
      credential_id: "018f0000-0000-7000-8000-000000000011", key_id: "TEST_DEVICE_TRUST", tenant_id: binding.tenantId,
      company_id: binding.companyId, installation_id: binding.installationId, device_id: binding.deviceId,
      device_public_key_pem: publicKey, issued_at: time.toISOString(), not_before: time.toISOString(),
      expires_at: "2026-10-22T14:00:00Z", version: 1,
    });
    const credential = { claims, signature: sign(null, unsignedDeviceTrustCredentialBytes(claims), issuer.privateKey).toString("base64url") };
    return { status: "ENROLLED", activation_id: activation.activation_id, credential_id: claims.credential_id, credential, enrolled_at: time.toISOString(), reason: null, version: 1 };
  }
  return { directory, root, keys, build, activation, result, now, advance: () => { time = new Date("2026-10-22T15:00:00Z"); } };
}
describe("Android canonical local-security and device enrollment composition", () => {
  it("license observation: reuses accepted capacity only with live enrolled device and trusted installation scope",async()=>{
    const f=fixture(),pair=generateKeyPairSync("ed25519"),branchId="018f0000-0000-7000-8000-000000000020",registerId="018f0000-0000-7000-8000-000000000021";
    const claims=LicenseCapacityClaimsSchema.parse({profile:"CAMACHO_LICENSE_CAPACITY_V2",license_id:"018f0000-0000-7000-8000-000000000022",
      tenant_id:binding.tenantId,company_id:binding.companyId,installation_id:binding.installationId,device_id:binding.deviceId,
      mode:"HYBRID",entitlements:["CASH_REGISTER"],issued_at:"2026-10-22T00:00:00Z",not_before:"2026-10-22T00:00:00Z",expires_at:"2026-10-23T00:00:00Z",offline_grace_until:null,
      key_id:"TEST_LICENSE",license_version:1,plan_id:"018f0000-0000-7000-8000-000000000023",plan_version:1,cash_register_capacity:{included:1,paid_additional:0,allocations:[{register_id:registerId,branch_id:branchId}]}});
    const artifact={claims,signature:sign(null,unsignedLicenseCapacityBytes(claims),pair.privateKey).toString("base64url")};
    const load=()=>({artifact,keys:new Map([[claims.key_id,{key:pair.publicKey,status:"ACTIVE" as const}]])});
    const runtime=f.build(f.root,{branchId,load}).runtime;await runtime.start();
    expect(runtime.licenseInformation().status).toBe("UNVERIFIED");
    runtime.completeEnrollment(f.result(runtime.prepareEnrollment(f.activation).request!));
    expect(runtime.licenseInformation().status).toBe("UNVERIFIED");await runtime.stop();
    const db=LocalDatabase.open({dataDirectory:f.directory});
    try{expect(new LicenseCapacityGate(db,load,f.now).authorize({...binding,branchId},registerId)).toBeNull();}finally{db.close();}
    const reopened=f.build(f.root,{branchId,load}).runtime;await reopened.start();
    expect(reopened.licenseInformation().status).toBe("CURRENT");expect(reopened.status().external_channel).toBe("CLOSED");
    f.keys.set("TEST_DEVICE_TRUST",{...f.keys.get("TEST_DEVICE_TRUST")!,status:"REVOKED"});
    expect(reopened.licenseInformation().status).toBe("UNVERIFIED");
    await reopened.stop();expect(reopened.licenseInformation().status).toBe("UNVERIFIED");
  });
  it("requires actual trusted dependencies, not a serialized provider/verifier", () => {
    expect(() => new AndroidSecurityFoundation("unused", binding, {} as never, {} as never, () => new Date())).toThrow("ANDROID_TRUSTED_SECURITY_DEPENDENCIES_REQUIRED");
  });
  it("materializes security without granting a session; consumes the seed provider at startup", async () => {
    const f = fixture(); const { runtime, provider } = f.build();
    expect(() => runtime.prepareEnrollment(f.activation)).toThrow("ANDROID_SECURITY_NOT_READY");
    await runtime.start();
    expect(() => provider.loadKey("context")).toThrow("DESTROYED");
    expect(() => runtime.requireVerifiedDevice()).toThrow("DEVICE_TRUST_NOT_PROVISIONED");
    expect(runtime.status()).toMatchObject({ state: "READY", commercial_access: "BLOCKED_PENDING_BUSINESS_AUTHORITY", external_channel: "CLOSED" });
    expect(runtime.prepareEnrollment({ ...f.activation, tenant_id: binding.deviceId }).decision).toBe("BINDING_MISMATCH");
    expect(runtime.prepareEnrollment(f.activation).decision).toBe("READY");
    expect(runtime.prepareEnrollment(f.activation).decision).toBe("PENDING");
  });
  it("verifies, persists, and reopens the same local identity and central credential without granting BUSINESS", async () => {
    const f = fixture(); const { runtime } = f.build(); await runtime.start();
    const prepared = runtime.prepareEnrollment(f.activation).request!;
    const result = f.result(prepared); runtime.completeEnrollment(result);
    expect(runtime.requireVerifiedDevice()).toEqual(result.credential);
    expect(() => runtime.completeEnrollment(result)).toThrow("already been consumed");
    await runtime.stop(); const second = f.build().runtime; await second.start();
    expect(second.requireVerifiedDevice()).toEqual(result.credential);
    expect(second.prepareEnrollment(f.activation).decision).toBe("ALREADY_ENROLLED");
    expect(second.status().external_channel).toBe("CLOSED");
  });
  it("rejects an authentic central credential certifying another key under identical IDs", async () => {
    const f = fixture(); const { runtime } = f.build(); await runtime.start();
    const request = runtime.prepareEnrollment(f.activation).request!;
    const foreignKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => runtime.completeEnrollment(f.result(request, foreignKey))).toThrow("DEVICE_ENROLLMENT_LOCAL_KEY_MISMATCH");
    expect(() => runtime.requireVerifiedDevice()).toThrow("NOT_PROVISIONED");
    runtime.completeEnrollment(f.result(request)); expect(runtime.requireVerifiedDevice().claims.device_public_key_pem).toBe(request.device_public_key_pem);
  });
  it("rejects altered signatures without consuming enrollment or persisting a credential", async () => {
    const f = fixture(); const { runtime } = f.build(); await runtime.start();
    const request = runtime.prepareEnrollment(f.activation).request!; const result = f.result(request);
    expect(() => runtime.completeEnrollment({ ...result, credential: { ...result.credential, signature: "A".repeat(86) } })).toThrow("CREDENTIAL_SIGNATURE_INVALID");
    expect(() => runtime.requireVerifiedDevice()).toThrow("NOT_PROVISIONED");
    runtime.completeEnrollment(result);
  });
  it("rechecks expiry on use and rejects expired material at reboot, releasing writer ownership", async () => {
    const f = fixture(); const { runtime } = f.build(); await runtime.start();
    runtime.completeEnrollment(f.result(runtime.prepareEnrollment(f.activation).request!)); f.advance();
    expect(() => runtime.requireVerifiedDevice()).toThrow("CREDENTIAL_EXPIRED"); await runtime.stop();
    const second = f.build().runtime; await expect(second.start()).rejects.toThrow("runtime start failed");
    const probe = new AndroidServiceFoundation(f.directory); await probe.start(); await probe.stop();
  });
  it("rechecks operational revocation on each access", async () => {
    const f = fixture(); const { runtime } = f.build(); await runtime.start();
    runtime.completeEnrollment(f.result(runtime.prepareEnrollment(f.activation).request!));
    f.keys.set("TEST_DEVICE_TRUST", { ...f.keys.get("TEST_DEVICE_TRUST")!, status: "REVOKED" });
    expect(() => runtime.requireVerifiedDevice()).toThrow("KEY_REVOKED");
  });
  it("denies a concurrent writer without disturbing the ready security instance", async () => {
    const f = fixture(); const first = f.build().runtime; await first.start();
    const { runtime: second, provider } = f.build(); await expect(second.start()).rejects.toThrow("runtime start failed");
    expect(() => provider.loadKey("context")).toThrow("DESTROYED");
    expect(first.prepareEnrollment(f.activation).decision).toBe("READY");
  });
  it("rejects a central credential bound to a different tenant", async () => {
    const f = fixture(); const runtime = f.build().runtime; await runtime.start();
    const result = f.result(runtime.prepareEnrollment(f.activation).request!);
    // This altered binding is also signature-invalid: neither condition may grant access.
    result.credential.claims.tenant_id = binding.deviceId;
    expect(() => runtime.completeEnrollment(result)).toThrow("CREDENTIAL_SIGNATURE_INVALID");
    expect(() => runtime.requireVerifiedDevice()).toThrow("NOT_PROVISIONED");
  });
  it("blocks credentials left by an audit failure both immediately and after reopening", async () => {
    const f = fixture();
    const database = LocalDatabase.open({ dataDirectory: f.directory });
    database.native.exec("CREATE TRIGGER test_reject_enrollment BEFORE INSERT ON local_security_audit WHEN NEW.event_type='DEVICE_ENROLLMENT_COMPLETED' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END");
    database.close();
    const runtime = f.build().runtime; await runtime.start();
    const result = f.result(runtime.prepareEnrollment(f.activation).request!);
    expect(() => runtime.completeEnrollment(result)).toThrow("test audit unavailable");
    expect(() => runtime.requireVerifiedDevice()).toThrow("COMPLETION_NOT_RECORDED");
    await runtime.stop(); await expect(f.build().runtime.start()).rejects.toThrow("runtime start failed");
    const probe = new AndroidServiceFoundation(f.directory); await probe.start(); await probe.stop();
  });
  it("fails closed on a wrong wrapping root and cleans partial security initialization", async () => {
    const f = fixture(); const { runtime } = f.build(); await runtime.start(); await runtime.stop();
    const wrong = randomBytes(32); roots.push(wrong); const { runtime: second, provider } = f.build(wrong);
    await expect(second.start()).rejects.toThrow("runtime start failed");
    expect(() => provider.loadKey("context")).toThrow("DESTROYED");
    const recovered = f.build().runtime; await recovered.start();
    expect(recovered.status().commercial_access).toBe("BLOCKED_PENDING_BUSINESS_AUTHORITY");
  });
});
