import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  DestinationSnapshotSchema,
  applyVerifiedDestinationSnapshot,
  visibleCompanyDestination,
  type DestinationProjectionScope,
  type DestinationProjectionState,
  type DestinationSnapshot,
} from "@pos-platform/domain";

interface Row { sequence: number; issued_at: string; expires_at: string; received_at: string; payload_json: string; }

/**
 * QR-001 local read cache. Must only be called by a trusted service after
 * verifying a Central-issued snapshot's signature and binding.
 *
 * No IPC surface and NO write API for cashiers or administrative renderer.
 * This store does NOT provide a bank notification or proof of payment.
 */
export class SqliteMerchantDestinationProjectionStore {
  constructor(private readonly database: LocalDatabase) {}

  load(scope: DestinationProjectionScope): DestinationProjectionState | null {
    const row = this.database.native.prepare(
      `SELECT sequence,issued_at,expires_at,received_at,payload_json
       FROM local_merchant_payment_destination_snapshot
       WHERE tenant_id=? AND company_id=?`,
    ).get(scope.tenantId,scope.companyId) as Row | undefined;
    if (!row) return null;
    const payload: unknown = JSON.parse(row.payload_json);
    const snapshot = DestinationSnapshotSchema.parse(payload);
    if (snapshot.tenant_id !== scope.tenantId || snapshot.company_id !== scope.companyId ||
        snapshot.sequence !== row.sequence || snapshot.issued_at !== row.issued_at ||
        snapshot.expires_at !== row.expires_at) throw new Error("DESTINATION_SNAPSHOT_CORRUPTED");
    return {snapshot,received_at:row.received_at};
  }

  /** Insert/replace as one SQLite single-writer transaction with CAS sequencing. */
  activatePreverified(
    scope: DestinationProjectionScope,
    snapshot: DestinationSnapshot,
    receivedAt: string,
  ): DestinationProjectionState {
    return this.database.native.transaction(() => {
      const existing=this.load(scope);
      const next=applyVerifiedDestinationSnapshot(existing,snapshot,scope,receivedAt);
      const result=this.database.native.prepare(
        `INSERT INTO local_merchant_payment_destination_snapshot
           (tenant_id,company_id,sequence,issued_at,expires_at,received_at,payload_json)
           VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,company_id) DO UPDATE SET
           sequence=excluded.sequence,issued_at=excluded.issued_at,
           expires_at=excluded.expires_at,received_at=excluded.received_at,
           payload_json=excluded.payload_json
         WHERE excluded.sequence > local_merchant_payment_destination_snapshot.sequence`
      ).run(next.snapshot.tenant_id,next.snapshot.company_id,next.snapshot.sequence,
        next.snapshot.issued_at,next.snapshot.expires_at,next.received_at,JSON.stringify(next.snapshot));
      if (result.changes !== 1) throw new Error("DESTINATION_SEQUENCE_CONFLICT");
      return next;
    })();
  }

  display(scope: DestinationProjectionScope, now: string) {
    return visibleCompanyDestination(this.load(scope),scope,now);
  }
}
