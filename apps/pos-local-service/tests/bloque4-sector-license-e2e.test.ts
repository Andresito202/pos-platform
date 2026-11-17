import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CanonicalPermission,
  LicenseSectorEntitlement,
  type LicenseCapacityClaims,
} from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LicenseCapacityGate, readLicenseCapacityProvision } from "../src/security/license-capacity-gate.js";
import { LocalSecurityLifecycle } from "../src/security/security-lifecycle.js";
import { unsignedLicenseCapacityBytes } from "../src/security/license-verifier.js";
import { localOperatorAuthorization } from "../src/security/local-operator-development-bridge.js";
import type { LocalOperator } from "../src/security/local-operator-password.js";
import type { ServiceConfig } from "../src/config.js";

/**
 * Bloque 4 integral: three independent companies × four local roles × sector
 * license isolation. Uses the existing signed capacity authority — no parallel
 * licensing. Local SUPERADMINISTRADOR remains audit-only (GLOBAL is Central).
 */
const id = (n: number) => `018f0000-0000-7000-8000-${n.toString().padStart(12, "0")}`;

type CompanyFixture = {
  label: "SALSAMENTARIA" | "FARMACIA" | "PASTELERIA";
  sector: string;
  tenantId: string;
  companyId: string;
  branchId: string;
  installationId: string;
  deviceId: string;
  licenseId: string;
  registerId: string;
};

const companies: readonly CompanyFixture[] = [
  {
    label: "SALSAMENTARIA",
    sector: LicenseSectorEntitlement.SALSAMENTARIA,
    tenantId: id(1), companyId: id(100), branchId: id(101),
    installationId: id(102), deviceId: id(103), licenseId: id(104), registerId: id(105),
  },
  {
    label: "FARMACIA",
    sector: LicenseSectorEntitlement.FARMACIA,
    tenantId: id(1), companyId: id(200), branchId: id(201),
    installationId: id(202), deviceId: id(203), licenseId: id(204), registerId: id(205),
  },
  {
    label: "PASTELERIA",
    sector: LicenseSectorEntitlement.PASTELERIA,
    tenantId: id(1), companyId: id(300), branchId: id(301),
    installationId: id(302), deviceId: id(303), licenseId: id(304), registerId: id(305),
  },
];

const ROLES: readonly LocalOperator["role"][] = [
  "CAJERO", "SUPERVISOR", "ADMINISTRADOR", "SUPERADMINISTRADOR",
];

const resources: { db: LocalDatabase; dir: string }[] = [];
afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.db.close();
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function provisionCompany(company: CompanyFixture, at = new Date("2026-10-26T12:00:00Z")) {
  const dir = mkdtempSync(join(tmpdir(), `pos-b4-${company.label.toLowerCase()}-`));
  const db = LocalDatabase.open({ dataDirectory: dir });
  resources.push({ db, dir });
  new LocalSecurityLifecycle(db).registerInitialDeviceKey(`DEVICE_${company.label}`);
  const pair = generateKeyPairSync("ed25519");
  const claims: LicenseCapacityClaims = {
    profile: "CAMACHO_LICENSE_CAPACITY_V2",
    license_id: company.licenseId,
    tenant_id: company.tenantId,
    company_id: company.companyId,
    installation_id: company.installationId,
    device_id: company.deviceId,
    mode: "HYBRID",
    entitlements: ["CASH_REGISTER", company.sector],
    issued_at: "2026-10-26T00:00:00Z",
    not_before: "2026-10-26T00:00:00Z",
    expires_at: "2026-10-27T00:00:00Z",
    offline_grace_until: null,
    key_id: `LICENSE_${company.label}`,
    license_version: 1,
    plan_id: id(700),
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
    profile: "CAMACHO_LICENSE_CAPACITY_PROVISION_V2" as const,
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
  const scope = {
    tenantId: company.tenantId,
    companyId: company.companyId,
    branchId: company.branchId,
    installationId: company.installationId,
    deviceId: company.deviceId,
  };
  const config = {
    tenant_id: company.tenantId,
    company_id: company.companyId,
    branch_id: company.branchId,
    installation_id: company.installationId,
    device_id: company.deviceId,
    local_operator_auth_store: "/tmp/b4-accounts.json",
  } as ServiceConfig;
  return { company, claims, gate, scope, config, path, provision, save: (v: unknown) => writeFileSync(path, JSON.stringify(v)), pair };
}

function rolePermissions(role: LocalOperator["role"], company: CompanyFixture): ReadonlySet<string> {
  const username = (
    role === "ADMINISTRADOR" ? "admin.local"
      : role === "CAJERO" ? "cajero.local"
        : role === "SUPERVISOR" ? "supervisor.local"
          : "superadmin.local"
  ) as LocalOperator["username"];
  const { snapshot } = localOperatorAuthorization({
    sessionId: id(900),
    username,
    role,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }, {
    tenant_id: company.tenantId,
    company_id: company.companyId,
    branch_id: company.branchId,
    installation_id: company.installationId,
    device_id: company.deviceId,
  } as ServiceConfig);
  return new Set(
    snapshot.claims.assignments.flatMap((a) =>
      a.permissions.filter((p) => p.status === "ACTIVE").map((p) => p.code),
    ),
  );
}

describe("bloque4 sector licenses × 3 companies × 4 roles", () => {
  it("projects only the contracted sector entitlement per company", () => {
    const fixtures = companies.map((company) => provisionCompany(company));
    for (const fixture of fixtures) {
      expect(fixture.gate().authorize(fixture.scope, fixture.company.registerId)).toBeNull();
      expect([...fixture.gate().listEntitlements(fixture.scope)].sort()).toEqual(
        ["CASH_REGISTER", fixture.company.sector].sort(),
      );
      expect(fixture.gate().authorizeEntitlement(fixture.scope, fixture.company.sector)).toBeNull();
    }
    const [salsamentaria, farmacia, pasteleria] = fixtures;
    // Cross-sector denial on the same installation's signed claims.
    expect(salsamentaria!.gate().authorizeEntitlement(salsamentaria!.scope, LicenseSectorEntitlement.FARMACIA))
      .toBe("LICENSE_ENTITLEMENT_MISSING");
    expect(farmacia!.gate().authorizeEntitlement(farmacia!.scope, LicenseSectorEntitlement.PASTELERIA))
      .toBe("LICENSE_ENTITLEMENT_MISSING");
    expect(pasteleria!.gate().authorizeEntitlement(pasteleria!.scope, LicenseSectorEntitlement.SALSAMENTARIA))
      .toBe("LICENSE_ENTITLEMENT_MISSING");
  });

  it("rejects cross-company scope and register contamination", () => {
    const [a, b, c] = companies.map((company) => provisionCompany(company));
    for (const fixture of [a!, b!, c!]) {
      expect(fixture.gate().authorize(fixture.scope, fixture.company.registerId)).toBeNull();
    }
    expect(a!.gate().authorize(b!.scope, b!.company.registerId)).not.toBeNull();
    expect(b!.gate().authorize(c!.scope, c!.company.registerId)).not.toBeNull();
    expect(c!.gate().authorize(a!.scope, a!.company.registerId)).not.toBeNull();
    expect(a!.gate().authorizeEntitlement(
      { ...a!.scope, companyId: b!.company.companyId },
      LicenseSectorEntitlement.SALSAMENTARIA,
    )).toBe("LICENSE_SCOPE_MISMATCH");
    expect(a!.gate().authorizeEntitlement(b!.scope, LicenseSectorEntitlement.FARMACIA)).not.toBeNull();
  });

  it("blocks local tampering of entitlements without a valid signature", () => {
    const fixture = provisionCompany(companies[0]!);
    expect(fixture.gate().authorize(fixture.scope, fixture.company.registerId)).toBeNull();
    const tampered = {
      ...fixture.claims,
      entitlements: [
        "CASH_REGISTER",
        LicenseSectorEntitlement.SALSAMENTARIA,
        LicenseSectorEntitlement.FARMACIA,
        LicenseSectorEntitlement.PASTELERIA,
      ],
    };
    // Unsigned rewrite of the provision file must not grant extra sectors.
    fixture.save({
      profile: "CAMACHO_LICENSE_CAPACITY_PROVISION_V2",
      keys: fixture.provision().keys,
      artifact: {
        claims: tampered,
        signature: fixture.provision().artifact.signature,
      },
    });
    expect(fixture.gate().authorizeEntitlement(fixture.scope, LicenseSectorEntitlement.FARMACIA))
      .toBe("LICENSE_SIGNATURE_INVALID");
    expect(fixture.gate().listEntitlements(fixture.scope)).toEqual([]);
  });

  it("maps four local roles to positive/negative permissions without GLOBAL licensing", () => {
    const company = companies[0]!;
    const expected = {
      CAJERO: {
        has: [CanonicalPermission.SALES_SALE_CREATE, CanonicalPermission.CASH_SHIFT_OPEN],
        missing: [
          CanonicalPermission.INVENTORY_STOCK_ADJUST,
          CanonicalPermission.BAKERY_RECIPE_MANAGE,
          CanonicalPermission.LICENSE_PLAN_MANAGE,
        ],
      },
      SUPERVISOR: {
        has: [CanonicalPermission.INVENTORY_STOCK_READ, CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM],
        missing: [
          CanonicalPermission.SALES_SALE_CREATE,
          CanonicalPermission.INVENTORY_STOCK_ADJUST,
          CanonicalPermission.LICENSE_PLAN_MANAGE,
        ],
      },
      ADMINISTRADOR: {
        has: [
          CanonicalPermission.INVENTORY_STOCK_ADJUST,
          CanonicalPermission.CATALOG_PRODUCT_REGISTER,
          CanonicalPermission.BAKERY_PRODUCTION_DEVIATE,
        ],
        missing: [CanonicalPermission.SALES_SALE_CREATE, CanonicalPermission.LICENSE_PLAN_MANAGE],
      },
      SUPERADMINISTRADOR: {
        has: [CanonicalPermission.AUDIT_EVENT_READ],
        missing: [
          CanonicalPermission.SALES_SALE_CREATE,
          CanonicalPermission.INVENTORY_STOCK_ADJUST,
          CanonicalPermission.LICENSE_PLAN_MANAGE,
        ],
      },
    } as const;

    for (const role of ROLES) {
      const permissions = rolePermissions(role, company);
      for (const code of expected[role].has) expect(permissions.has(code)).toBe(true);
      for (const code of expected[role].missing) expect(permissions.has(code)).toBe(false);
    }
  });

  it("keeps inventory and sector capacity independent across the three companies", () => {
    const fixtures = companies.map((company) => provisionCompany(company));
    // Each company activates and retains its own capacity after the others do.
    for (const fixture of fixtures) {
      expect(fixture.gate().authorize(fixture.scope, fixture.company.registerId)).toBeNull();
      expect(fixture.gate().information(fixture.scope).status).toBe("CURRENT");
    }
    // Revoking Pastelería does not strip Salsamentaria/Farmacia.
    new LocalSecurityLifecycle(resources[2]!.db).revokeLicense(companies[2]!.licenseId, "bloque4");
    expect(fixtures[2]!.gate().authorizeEntitlement(fixtures[2]!.scope, LicenseSectorEntitlement.PASTELERIA))
      .toBe("LICENSE_REVOKED");
    expect(fixtures[0]!.gate().authorizeEntitlement(fixtures[0]!.scope, LicenseSectorEntitlement.SALSAMENTARIA))
      .toBeNull();
    expect(fixtures[1]!.gate().authorizeEntitlement(fixtures[1]!.scope, LicenseSectorEntitlement.FARMACIA))
      .toBeNull();
  });

  it("persists accepted capacity across gate reconstruction (restart)", () => {
    const fixture = provisionCompany(companies[1]!);
    expect(fixture.gate().authorize(fixture.scope, fixture.company.registerId)).toBeNull();
    expect(fixture.gate().listEntitlements(fixture.scope)).toContain(LicenseSectorEntitlement.FARMACIA);
    const restarted = new LicenseCapacityGate(
      resources[0]!.db,
      () => readLicenseCapacityProvision(fixture.path),
      () => new Date("2026-10-26T12:30:00Z"),
    );
    expect(restarted.authorizeEntitlement(fixture.scope, LicenseSectorEntitlement.FARMACIA)).toBeNull();
    expect([...restarted.listEntitlements(fixture.scope)]).toEqual(
      expect.arrayContaining(["CASH_REGISTER", LicenseSectorEntitlement.FARMACIA]),
    );
  });
});
