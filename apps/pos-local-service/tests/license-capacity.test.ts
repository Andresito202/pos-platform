import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LicenseCapacityClaimsSchema, type LicenseCapacityClaims } from "@pos-platform/contracts";
import { LicenseCapacityGate, readLicenseCapacityProvision } from "../src/security/license-capacity-gate.js";
import { LocalSecurityLifecycle } from "../src/security/security-lifecycle.js";
import { unsignedLicenseCapacityBytes } from "../src/security/license-verifier.js";

const id = (n: number) => `018f0000-0000-7000-8000-${n.toString().padStart(12,"0")}`;
const scope = {tenantId:id(1),companyId:id(2),branchId:id(3),installationId:id(4),deviceId:id(5)};
const resources: {db:LocalDatabase;dir:string}[]=[];
afterEach(()=>{for(const r of resources.splice(0)){r.db.close();rmSync(r.dir,{recursive:true,force:true});}});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),"pos-license-capacity-"));let db=LocalDatabase.open({dataDirectory:dir});
  const resource={db,dir};resources.push(resource);
  new LocalSecurityLifecycle(db).registerInitialDeviceKey("DEVICE_TEST");
  const pair=generateKeyPairSync("ed25519");
  let at=new Date("2026-10-26T12:00:00Z");
  const claims:LicenseCapacityClaims={profile:"CAMACHO_LICENSE_CAPACITY_V2",license_id:id(6),tenant_id:scope.tenantId,
    company_id:scope.companyId,installation_id:scope.installationId,device_id:scope.deviceId,mode:"HYBRID",entitlements:["CASH_REGISTER"],
    issued_at:"2026-10-26T00:00:00Z",not_before:"2026-10-26T00:00:00Z",expires_at:"2026-10-27T00:00:00Z",offline_grace_until:null,
    key_id:"LICENSE_TEST",license_version:1,plan_id:id(7),plan_version:1,
    cash_register_capacity:{included:1,paid_additional:0,allocations:[{register_id:id(8),branch_id:scope.branchId}]}};
  const path=join(dir,"public-license.json");
  const signed=(c:LicenseCapacityClaims)=>({claims:c,signature:sign(null,unsignedLicenseCapacityBytes(c),pair.privateKey).toString("base64url")});
  const provision=(c=claims,status="ACTIVE")=>({profile:"CAMACHO_LICENSE_CAPACITY_PROVISION_V2",keys:[{key_id:c.key_id,
    public_key_pem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),
    spki_sha256:createHash("sha256").update(pair.publicKey.export({type:"spki",format:"der"})).digest("hex"),status}],artifact:signed(c)});
  const save=(value:unknown)=>writeFileSync(path,JSON.stringify(value));save(provision());
  const gate=()=>new LicenseCapacityGate(db,()=>readLicenseCapacityProvision(path),()=>at);
  return {get db(){return db;},path,claims,gate,save,provision,setTime:(v:string)=>{at=new Date(v);},
    restart:()=>{db.close();db=LocalDatabase.open({dataDirectory:dir});resource.db=db;}};
}

it("capacity: includes one register, permits signed paid extras, rejects duplicate/excess allocations",()=>{
  const f=fixture();expect(f.gate().authorize(scope,id(8))).toBeNull();
  expect(f.gate().authorize(scope,id(9))).toBe("LICENSE_REGISTER_NOT_ALLOCATED");
  const c=structuredClone(f.claims);c.cash_register_capacity.allocations.push({register_id:id(9),branch_id:scope.branchId});
  expect(LicenseCapacityClaimsSchema.safeParse(c).success).toBe(false);
  c.cash_register_capacity.paid_additional=1;c.license_version=2;
  f.save(f.provision(c));expect(f.gate().authorize(scope,id(9))).toBeNull();
  c.cash_register_capacity.allocations[1]!.register_id=id(8);
  expect(LicenseCapacityClaimsSchema.safeParse(c).success).toBe(false);
  expect(LicenseCapacityClaimsSchema.safeParse({...f.claims,cash_register_capacity:{...f.claims.cash_register_capacity,included:3}}).success).toBe(false);
});

it("capacity: enforces signature, key revocation, tenant/company/branch/device and expiration",()=>{
  const f=fixture();
  const altered=f.provision();altered.artifact.claims.plan_version=2;f.save(altered);
  expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_SIGNATURE_INVALID");
  f.save(f.provision());
  for(const changed of [{tenantId:id(99)},{companyId:id(99)},{branchId:id(99)},{deviceId:id(99)},{installationId:id(99)}])
    expect(f.gate().authorize({...scope,...changed},id(8))).not.toBeNull();
  f.save(f.provision(f.claims,"REVOKED"));expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_SIGNING_KEY_REVOKED");
  f.save(f.provision());f.setTime("2026-10-28T00:00:00Z");expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_EXPIRED");
});

it("capacity: database restart preserves version floor and a signature cannot clear suspension",()=>{
  const f=fixture();expect(f.gate().authorize(scope,id(8))).toBeNull();
  const newer={...f.claims,license_version:2};f.save(f.provision(newer));expect(f.gate().authorize(scope,id(8))).toBeNull();
  f.restart();
  f.save(f.provision());expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_ROLLBACK_OR_CONFLICT");
  f.save(f.provision({...newer,plan_version:2}));expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_ROLLBACK_OR_CONFLICT");
  f.save(f.provision(newer));expect(f.gate().authorize(scope,id(8))).toBeNull();
  expect(f.db.native.prepare("SELECT count(*) AS n FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_ACCEPTED'").get()).toEqual({n:2});
  new LocalSecurityLifecycle(f.db).suspendLicense(f.claims.license_id,"operator");
  f.save(f.provision({...newer,license_version:3}));expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_SUSPENDED");
});

it("capacity: audit failure rolls activation back; legacy/malformed trust never grants capacity",()=>{
  const f=fixture();f.db.native.exec(`CREATE TRIGGER reject_capacity_audit BEFORE INSERT ON local_security_audit
    WHEN NEW.event_type='LICENSE_CAPACITY_ACCEPTED' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END`);
  expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_CAPACITY_UNAVAILABLE");
  expect(f.db.native.prepare("SELECT count(*) AS n FROM local_license_activation_state").get()).toEqual({n:0});
  f.db.native.exec("DROP TRIGGER reject_capacity_audit");
  f.save({profile:"CAMACHO_LICENSE_CAPACITY_PROVISION_V2",artifact:{claims:{license_id:id(6)}}});
  expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_CAPACITY_UNAVAILABLE");
  const bad=f.provision();bad.keys[0]!.spki_sha256="0".repeat(64);f.save(bad);
  expect(f.gate().authorize(scope,id(8))).toBe("LICENSE_CAPACITY_UNAVAILABLE");
  expect(()=>readLicenseCapacityProvision("relative.json")).toThrow();
});

it("information: signed expiry, accepted renewal, suspension and company isolation; reading never grants or renews",()=>{
  const f=fixture();expect(f.gate().information(scope).status).toBe('UNVERIFIED');
  expect(f.db.native.prepare('SELECT count(*) AS n FROM local_license_activation_state').get()).toEqual({n:0});
  expect(f.gate().authorize(scope,id(8))).toBeNull();
  const audits=()=>f.db.native.prepare("SELECT count(*) AS n FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_ACCEPTED'").get();
  expect(f.gate().information(scope)).toMatchObject({status:'CURRENT',signedValidUntil:f.claims.expires_at});expect(audits()).toEqual({n:1});
  expect(f.gate().information({...scope,companyId:id(99)}).status).toBe('UNVERIFIED');
  f.setTime('2026-10-27T00:00:00.001Z');expect(f.gate().information(scope).status).toBe('EXPIRED');
  expect(f.gate().authorize(scope,id(8))).toBe('LICENSE_EXPIRED');
  const renewed={...f.claims,license_version:2,expires_at:'2026-11-27T00:00:00Z'};f.save(f.provision(renewed));
  expect(f.gate().information(scope).status).toBe('UNVERIFIED');expect(audits()).toEqual({n:1});
  expect(f.gate().authorize(scope,id(8))).toBeNull();expect(f.gate().information(scope).status).toBe('CURRENT');expect(audits()).toEqual({n:2});
  const altered=f.provision(structuredClone(renewed));altered.artifact.claims.plan_version=99;f.save(altered);expect(f.gate().information(scope).status).toBe('UNVERIFIED');
  f.save(f.provision(renewed));new LocalSecurityLifecycle(f.db).suspendLicense(f.claims.license_id,'test operator');
  expect(f.gate().information(scope).status).toBe('SUSPENDED');expect(f.gate().authorize(scope,id(8))).toBe('LICENSE_SUSPENDED');
  f.restart();expect(f.gate().information(scope).status).toBe('SUSPENDED');
  new LocalSecurityLifecycle(f.db).revokeLicense(f.claims.license_id,'test operator revocation');expect(f.gate().information(scope).status).toBe('REVOKED');
});
