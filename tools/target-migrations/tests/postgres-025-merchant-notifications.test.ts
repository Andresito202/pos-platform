import {describe,expect,it} from "vitest";
import {commercialMigrationManifest,POSTGRES_024_DESCRIPTOR,POSTGRES_025_DESCRIPTOR} from "../src/postgres-commercial-runner.js";
import {readArtifact,sha256} from "../src/shared.js";

describe("QR-002 migration 025: explicit consent-gated notification evidence",()=>{
 it("is registered only under an explicit successor migration target",async()=>{
  expect(POSTGRES_025_DESCRIPTOR.migrationId).toBe("025_merchant_payment_notifications");
  expect(POSTGRES_025_DESCRIPTOR.dependencies).toEqual([POSTGRES_024_DESCRIPTOR.migrationId]);
  const source=await readArtifact(POSTGRES_025_DESCRIPTOR.upArtifact);
  const manifest=await commercialMigrationManifest("MERCHANT_NOTIFICATIONS");
  expect(manifest[POSTGRES_025_DESCRIPTOR.migrationId]).toBe(sha256(source).toString("hex"));
  expect((await commercialMigrationManifest("MERCHANT_DESTINATIONS"))[POSTGRES_025_DESCRIPTOR.migrationId]).toBeUndefined();
 });
 it("requires device consent and never enables bank-confirmed or sale-confirmed state",async()=>{
  const sql=await readArtifact(POSTGRES_025_DESCRIPTOR.upArtifact);
  expect(sql).toContain("FORCE ROW LEVEL SECURITY");
  expect(sql).toContain("merchant_notice_company_scope");
  expect(sql).toContain("merchant_notice_owner_evidence_read");
  expect(sql).toContain("merchant_notice_intake_guard");
  expect(sql).toContain("FOR SHARE OF c,d");
  expect(sql).toContain("merchant_notice_inbox_immutable");
  expect(sql).toContain("CHECK(bank_confirmed=false)");
  expect(sql).toContain("CHECK(sale_confirmed=false)");
  expect(sql).toContain("source_installation_id,message_sha256");
  expect(sql).not.toContain("payment.transfer.confirm");
  expect(sql).not.toContain("raw_sms");
  expect(sql).not.toContain("sms_body");
  expect(POSTGRES_025_DESCRIPTOR.ownedTables).toHaveLength(2);
 });
 it("refuses dropping stored notices or consent histories",async()=>{
  const down=await readArtifact(POSTGRES_025_DESCRIPTOR.downArtifact);
  expect(down).toContain("cannot downgrade");
  expect(down).toContain("EXISTS(SELECT 1 FROM payments.merchant_payment_notification_inbox)");
  expect(down).toContain("EXISTS(SELECT 1 FROM payments.merchant_notification_bridge_consents)");
  expect(down).not.toContain("CASCADE");
 });
});
