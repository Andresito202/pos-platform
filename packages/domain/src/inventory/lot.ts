/**
 * `Lot` (`inventory-receiving-schema.md` §"Lotes y vencimientos",
 * `conceptual-data-model.md:1496-1509`) — B31 boundary finding: a Lot is
 * created/resolved by `GoodsReceipt` confirmation, which belongs to
 * Purchasing (`PUR-001`), explicitly out of scope for this thread. B32
 * therefore models `Lot` as a read-only reference shape — `restore()`
 * only, no `create()` — so Inventory can validate a referenced `lotId`
 * (status, expiration) once a real repository exists, without inventing
 * a creation use case Inventory does not own.
 */
export type LotStatus = "ACTIVE" | "BLOCKED" | "DEPLETED" | "EXPIRED";

export interface RestoreLotInput {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly presentationId: string;
  readonly supplierId: string | null;
  readonly batchCode: string | null;
  readonly manufactureDate: Date | null;
  readonly expirationDate: Date | null;
  readonly receivedAt: Date;
  readonly parentLotId: string | null;
  readonly status: LotStatus;
  readonly version: number;
}

export class Lot {
  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly companyId: string,
    readonly presentationId: string,
    readonly supplierId: string | null,
    readonly batchCode: string | null,
    readonly manufactureDate: Date | null,
    readonly expirationDate: Date | null,
    readonly receivedAt: Date,
    readonly parentLotId: string | null,
    readonly status: LotStatus,
    readonly version: number,
  ) {}

  static restore(input: RestoreLotInput): Lot {
    return new Lot(
      input.id, input.tenantId, input.companyId, input.presentationId, input.supplierId, input.batchCode,
      input.manufactureDate, input.expirationDate, input.receivedAt, input.parentLotId, input.status, input.version,
    );
  }

  isUsable(): boolean {
    return this.status === "ACTIVE";
  }
}
