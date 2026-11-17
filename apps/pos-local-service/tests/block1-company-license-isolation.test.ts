import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { LicenseCapacityClaims } from "@pos-platform/contracts";
import { LicenseCapacityGate, readLicenseCapacityProvision } from "../src/security/license-capacity-gate.js";
import { LocalSecurityLifecycle } from "../src/security/security-lifecycle.js";
import { unsignedLicenseCapacityBytes } from "../src/security/license-verifier.js";

/**
 * Block 1: three independent companies must not share license authority.
 * Local operator credentials never substitute signed capacity claims.
 */
const id = (n: number) => `018f0000-0000-7000-8000-${n.toString().padStart(12, "0")}`;

type Company = {
  tenantId: string;
  companyId: string;
  branchId: string;
  installationId: string;
  deviceId: string;
  licenseId: string;
  registerId: string;
};

const companies: readonly Company[] = [
  {
    tenantId: id(1), companyId: id(10), branchId: id(11),
    installationId: id(12), deviceId: id(13), licenseId: id(14), registerId: id(15),
  },
  {
    tenantId: id(1), companyId: id(20), branchId: id(21),
    installationId: id(22), deviceId: id(23), licenseId: id(24), registerId: id(25),
  },
  {
    tenantId: id(1), companyId: id(30), branchId: id(31),
    installationId: id(32), deviceId: id(33), licenseId: id(34), registerId: id(35),
  },
];

const resources: { db: LocalDatabase; dir: string }[] = [];
afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.db.close();
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function provisionCompany(company: Company, at: Date = new Date("2026-10-26T12:00:00Z")) {
  const dir = mkdtempSync(join(tmpdir(), `pos-block1-license-${company.companyId.slice(-4)}-`));
  let db = LocalDatabase.open({ dataDirectory: dir });
  const resource = { db, dir };
  resources.push(resource);
  new LocalSecurityLifecycle(db).registerInitialDeviceKey(`DEVICE_${company.companyId.slice(-4)}`);
  const pair = generateKeyPairSync("ed25519");
  const claims: LicenseCapacityClaims = {
    profile: "CAMACHO_LICENSE_CAPACITY_V2",
    license_id: company.licenseId,
    tenant_id: company.tenantId,
    company_id: company.companyId,
    installation_id: company.installationId,
    device_id: company.deviceId,
    mode: "HYBRID",
    entitlements: ["CASH_REGISTER"],
    issued_at: "2026-10-26T00:00:00Z",
    not_before: "2026-10-26T00:00:00Z",
    expires_at: "2026-10-27T00:00:00Z",
    offline_grace_until: null,
    key_id: `LICENSE_${company.companyId.slice(-4)}`,
    license_version: 1,
    plan_id: id(70),
    plan_version: 1,
    cash_register_capacity: {
      included: 1,
      paid_additional: 0,
      allocations: [{ register_id: company.registerId, branch_id: company.branchId }],
    },
  };
  const path = join(dir, "public-license.json");
  const signed = (c: LicenseCapacityClaims) => ({
    claims: c,
    signature: sign(null, unsignedLicenseCapacityBytes(c), pair.privateKey).toString("base64url"),
  });
  const provision = (c = claims, status: "ACTIVE" | "REVOKED" = "ACTIVE") => ({
    profile: "CAMACHO_LICENSE_CAPACITY_PROVISION_V2",
    keys: [{
      key_id: c.key_id,
      public_key_pem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      spki_sha256: createHash("sha256").update(pair.publicKey.export({ type: "spki", format: "der" })).digest("hex"),
      status,
    }],
    artifact: signed(c),
  });
  writeFileSync(path, JSON.stringify(provision()));
  const gate = () => new LicenseCapacityGate(db, () => readLicenseCapacityProvision(path), () => at);
  return {
    company,
    claims,
    gate,
    save: (value: unknown) => writeFileSync(path, JSON.stringify(value)),
    provision,
    revoke: () => new LocalSecurityLifecycle(db).revokeLicense(company.licenseId, "block1"),
    scope: {
      tenantId: company.tenantId,
      companyId: company.companyId,
      branchId: company.branchId,
      installationId: company.installationId,
      deviceId: company.deviceId,
    },
  };
}

describe("block1 company and license isolation", () => {
  it("authorizes each of three companies only with its own signed capacity", () => {
    const fixtures = companies.map((company) => provisionCompany(company));
    for (const fixture of fixtures) {
      expect(fixture.gate().authorize(fixture.scope, fixture.company.registerId)).toBeNull();
    }
    // Company A license must not authorize company B register/device/company.
    const [a, b, c] = fixtures;
    expect(a!.gate().authorize(b!.scope, b!.company.registerId)).not.toBeNull();
    expect(b!.gate().authorize(c!.scope, c!.company.registerId)).not.toBeNull();
    expect(c!.gate().authorize(a!.scope, a!.company.registerId)).not.toBeNull();
    expect(a!.gate().authorize({ ...a!.scope, companyId: b!.company.companyId }, a!.company.registerId))
      .not.toBeNull();
    expect(a!.gate().authorize(a!.scope, b!.company.registerId)).toBe("LICENSE_REGISTER_NOT_ALLOCATED");
  });

  it("revoking one company license does not clear another company's capacity", () => {
    const [a, b] = companies.map((company) => provisionCompany(company));
    expect(a!.gate().authorize(a!.scope, a!.company.registerId)).toBeNull();
    expect(b!.gate().authorize(b!.scope, b!.company.registerId)).toBeNull();
    a!.revoke();
    expect(a!.gate().authorize(a!.scope, a!.company.registerId)).toBe("LICENSE_REVOKED");
    expect(b!.gate().authorize(b!.scope, b!.company.registerId)).toBeNull();
    expect(b!.gate().information(b!.scope).status).toBe("CURRENT");
    expect(a!.gate().information(a!.scope).status).toBe("REVOKED");
  });
});
