import {CashierDestinationSchema, MerchantDestinationDraftSchema, MerchantDestinationRevisionSchema, type CashierDestination, type MerchantDestinationRevision} from "./merchant-destination.js";

/** Scope and capability MUST be resolved from a verified backend session. */
export interface MerchantDestinationAccess {
  readonly tenantId: string;
  readonly companyId: string;
  readonly userId: string;
  /** Must come from an atomic administrative authorization decision, never a UI role string. */
  readonly canConfigure: boolean;
}

function assertScope(record: MerchantDestinationRevision, access: MerchantDestinationAccess): void {
  if (record.tenant_id !== access.tenantId || record.company_id !== access.companyId) {
    throw new Error("NOT_FOUND");
  }
}
function assertAdmin(access: MerchantDestinationAccess): void {
  if (!access.canConfigure) throw new Error("FORBIDDEN");
}
function checked(record: MerchantDestinationRevision): MerchantDestinationRevision {
  const revision = MerchantDestinationRevisionSchema.parse(record);
  MerchantDestinationDraftSchema.parse({kind: revision.kind, label: revision.label, destination_reference: revision.destination_reference, qr_asset_id: revision.qr_asset_id, qr_sha256: revision.qr_sha256});
  return revision;
}
function checkTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error("INVALID_TIMESTAMP");
  }
}
function mutate(record: MerchantDestinationRevision, access: MerchantDestinationAccess, expectedVersion: number, timestamp: string, target: "PUBLISHED"|"REVOKED"): MerchantDestinationRevision {
  const current=checked(record);
  assertScope(current,access);
  assertAdmin(access);
  if (current.version!==expectedVersion) throw new Error("VERSION_CONFLICT");
  if ((target==="PUBLISHED" && current.status!=="DRAFT") || (target==="REVOKED" && current.status!=="PUBLISHED")) {
    throw new Error("INVALID_TRANSITION");
  }
  checkTimestamp(timestamp);
  return checked({
    ...current,version:current.version+1,status:target,
    published_at:target==="PUBLISHED"?timestamp:current.published_at,
    revoked_at:target==="REVOKED"?timestamp:null,
  });
}
/**
 * Pure policy operation, not persistence. Caller MUST use DB CAS in a transaction
 * and append an immutable audit/outbox event; the version change alone is not atomic.
 */
export function publishDestination(record: MerchantDestinationRevision,access: MerchantDestinationAccess,expectedVersion: number,at: string): MerchantDestinationRevision {
  return mutate(record,access,expectedVersion,at,"PUBLISHED");
}
export function revokeDestination(record: MerchantDestinationRevision,access: MerchantDestinationAccess,expectedVersion: number,at: string): MerchantDestinationRevision {
  return mutate(record,access,expectedVersion,at,"REVOKED");
}
/**
 * Identical immutable projection for all company registers, never a write capability.
 * Offline clients need expiry/revocation handling supplied by the sync service.
 */
export function readCashierDestination(record: MerchantDestinationRevision, access: MerchantDestinationAccess): CashierDestination|null {
  const current=checked(record);
  if(current.tenant_id!==access.tenantId || current.company_id!==access.companyId || current.status!=="PUBLISHED") return null;
  return CashierDestinationSchema.parse({
    kind: current.kind,
    label: current.label,
    destination_reference: current.destination_reference,
    qr_asset_id: current.qr_asset_id,
    qr_sha256: current.qr_sha256,
    version: current.version,
  });
}
