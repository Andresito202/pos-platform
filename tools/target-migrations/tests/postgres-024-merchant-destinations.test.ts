import {describe,expect,it} from "vitest";
import {commercialMigrationManifest,POSTGRES_024_DESCRIPTOR} from "../src/postgres-commercial-runner.js";
import {readArtifact,sha256} from "../src/shared.js";

describe("QR-001 registered central migration 024",()=>{
 it("uses the canonical predecessor and immutable artifact checksum",async()=>{
  expect(POSTGRES_024_DESCRIPTOR.migrationId).toBe("024_merchant_payment_destinations");
  expect(POSTGRES_024_DESCRIPTOR.dependencies).toEqual(["023_license_offer_terms"]);
  const source=await readArtifact(POSTGRES_024_DESCRIPTOR.upArtifact);
  const manifest=await commercialMigrationManifest("MERCHANT_DESTINATIONS");
  expect(manifest[POSTGRES_024_DESCRIPTOR.migrationId]).toBe(sha256(source).toString("hex"));
 });
 it("protects every owned table with forced RLS and denies local POS roles",async()=>{
  const sql=await readArtifact(POSTGRES_024_DESCRIPTOR.upArtifact);
  expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  expect(sql).toContain("app.tenant_id");
  expect(sql).toContain("app.company_id");
  expect(sql).toContain("REVOKE ALL ON payments.%I FROM PUBLIC,pos_app,pos_worker,pos_reporting");
  expect(POSTGRES_024_DESCRIPTOR.ownedTables).toHaveLength(6);
  expect(sql).toContain("merchant_destination_one_published_kind");
  expect(sql).toContain("merchant_destination_no_delete");
  expect(sql).toContain("merchant_event_immutable");
  expect(sql).toContain("merchant_ack_identity");
 });
 it("does not silently delete merchant financial configuration in down migration",async()=>{
  const down=await readArtifact(POSTGRES_024_DESCRIPTOR.downArtifact);
  expect(down).toContain("cannot downgrade");
  expect(down).toContain("EXISTS(SELECT 1 FROM payments.merchant_destinations)");
  expect(down).not.toContain("CASCADE");
 });
});
