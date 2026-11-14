import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LicenseCapacityGate, readLicenseCapacityProvision } from "../src/security/license-capacity-gate.js";
import { LocalSecurityLifecycle } from "../src/security/security-lifecycle.js";

const script = join(process.cwd(), "scripts/prepare-commercial-design-review.ts");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function prepare(root: string): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, "--root", root], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`prepare failed: ${result.stderr || result.stdout}`);
  }
  const line = result.stdout.trim().split("\n").at(-1);
  return JSON.parse(line!) as Record<string, unknown>;
}

it("design-review prepare: persists IDs, signed capacity, register and demo catalog without touching other roots", () => {
  const root = mkdtempSync(join(tmpdir(), "camacho-design-review-"));
  roots.push(root);
  const first = prepare(root);
  const second = prepare(root);

  expect(second.installation_id).toBe(first.installation_id);
  expect(second.register_id).toBe(first.register_id);
  expect(second.license_capacity_provision_file).toBe(first.license_capacity_provision_file);
  expect(typeof first.license_capacity_provision_file).toBe("string");

  const provision = readLicenseCapacityProvision(String(first.license_capacity_provision_file));
  const scope = {
    tenantId: String(first.tenant_id),
    companyId: String(first.company_id),
    branchId: String(first.branch_id),
    installationId: String(first.installation_id),
    deviceId: String(first.device_id),
  };
  const database = LocalDatabase.open({ dataDirectory: String(first.data_directory) });
  try {
    new LocalSecurityLifecycle(database).registerInitialDeviceKey("DESIGN_REVIEW_TEST");
    const gate = new LicenseCapacityGate(database, () => readLicenseCapacityProvision(String(first.license_capacity_provision_file)));
    expect(gate.authorize(scope, String(first.register_id))).toBeNull();
    expect(gate.authorize(scope, "018f0000-0000-7000-8000-999999999999")).toBe("LICENSE_REGISTER_NOT_ALLOCATED");

    const register = database.native.prepare("SELECT status FROM cash_register WHERE id=?").get(String(first.register_id)) as { status: string };
    expect(register.status).toBe("ACTIVE");
    const products = database.native.prepare(
      "SELECT count(*) AS n FROM catalog_product WHERE tenant_id=? AND company_id=?",
    ).get(String(first.tenant_id), String(first.company_id)) as { n: number };
    expect(products.n).toBeGreaterThanOrEqual(4);
    const arroz = database.native.prepare(
      `SELECT p.name AS name FROM catalog_product p
       JOIN catalog_presentation pr ON pr.product_id=p.id
       WHERE p.tenant_id=? AND p.company_id=? AND pr.barcode=?`,
    ).get(String(first.tenant_id), String(first.company_id), "7701234567890") as { name: string };
    expect(arroz.name).toBe("Arroz");
  } finally {
    database.close();
  }

  const marker = readFileSync(join(root, "DESIGN_REVIEW_ISOLATED.txt"), "utf8");
  expect(marker).toContain("Isolated");
  expect(provision.artifact.claims.profile).toBe("CAMACHO_LICENSE_CAPACITY_V2");
});


it("separates identities, signing keys and SQLite data between two isolated roots", () => {
  const firstRoot=mkdtempSync(join(tmpdir(),"camacho-isolation-a-"));
  const secondRoot=mkdtempSync(join(tmpdir(),"camacho-isolation-b-"));
  roots.push(firstRoot,secondRoot);
  const first=prepare(firstRoot);
  const db=LocalDatabase.open({dataDirectory:String(first.data_directory)});
  let products: unknown;
  try { products=db.native.prepare("SELECT * FROM catalog_product ORDER BY id").all(); }
  finally { db.close(); }
  const installation=readFileSync(join(firstRoot,"installation.json"));
  const provision=readFileSync(String(first.license_capacity_provision_file));
  const second=prepare(secondRoot);
  for (const field of ["installation_id","device_id","tenant_id","company_id","branch_id","register_id","data_directory"]) {
    expect(second[field]).not.toBe(first[field]);
  }
  expect(readFileSync(join(firstRoot,"installation.json"))).toEqual(installation);
  expect(readFileSync(String(first.license_capacity_provision_file))).toEqual(provision);
  expect(readLicenseCapacityProvision(String(second.license_capacity_provision_file)).artifact.claims)
    .not.toEqual(readLicenseCapacityProvision(String(first.license_capacity_provision_file)).artifact.claims);
  const reopened=LocalDatabase.open({dataDirectory:String(first.data_directory)});
  try { expect(reopened.native.prepare("SELECT * FROM catalog_product ORDER BY id").all()).toEqual(products); }
  finally { reopened.close(); }
});
