import { createHash, randomUUID } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import { quantityFitsUnitPrecision } from "../quantity.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";

/**
 * Inventario — `MIGRATION_015`.
 *
 * `catalog_product.stock_controlled` existía desde `MIGRATION_014` y **no
 * gobernaba nada**. Este almacén lo convierte en comportamiento: mantiene la
 * existencia por sucursal y escribe el libro que explica por qué es la que es.
 *
 * ## El libro manda, la existencia se deriva
 *
 * `inventory_movement` sólo se inserta. `inventory_stock` es la suma del libro,
 * mantenida en la misma transacción para no recorrerlo entero en cada escaneo.
 * Que sea derivada la hace comprobable, y hay prueba de que ambas coinciden.
 *
 * ## La aritmética es la del dinero, a propósito
 *
 * La cantidad usa la misma escala 6 y las mismas funciones que el importe
 * (`../money.js`). Escribir aquí una segunda conversión de TEXT a entero sería
 * repetir exactamente el defecto que costó unificar la aritmética monetaria:
 * dos verdades sobre el mismo número acaban discrepando.
 */

const INVENTORY_PAYLOAD_SCHEMA_VERSION = "1.0.0";

/** Alcance de la existencia: **sucursal**. El mismo producto tiene existencias distintas en dos locales. */
export interface InventoryScope {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
}

export type InventoryMovementType =
  | "OPENING_COUNT"
  | "PURCHASE_RECEIPT"
  | "SALE_REVERSAL"
  | "ADJUSTMENT_POSITIVE"
  | "TRANSFER_IN"
  | "SALE"
  | "ADJUSTMENT_NEGATIVE"
  | "SHRINKAGE"
  | "TRANSFER_OUT";

/**
 * Qué tipos suman.
 *
 * El mismo emparejamiento está en un `CHECK` de `MIGRATION_015`: si este
 * conjunto y el `CHECK` discreparan, la escritura falla en vez de guardar una
 * dirección equivocada. La comprobación de la base es la que manda.
 */
const INBOUND_TYPES: ReadonlySet<InventoryMovementType> = new Set<InventoryMovementType>([
  "OPENING_COUNT",
  "PURCHASE_RECEIPT",
  "SALE_REVERSAL",
  "ADJUSTMENT_POSITIVE",
  "TRANSFER_IN",
]);

function movementDirection(movementType: InventoryMovementType): "IN" | "OUT" {
  return INBOUND_TYPES.has(movementType) ? "IN" : "OUT";
}

export interface InventoryStock {
  readonly presentationId: string;
  readonly quantityOnHand: string;
  readonly lastMovementSequence: number;
}

export interface AppendMovementInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly movementId: string;
  readonly operationId: string;
  readonly presentationId: string;
  readonly movementType: InventoryMovementType;
  /** TEXT a escala 6, estrictamente mayor que cero. La dirección la da el tipo. */
  readonly quantity: string;
  readonly reasonCode: string;
  readonly saleId: string | null;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

/**
 * Entrada y resultado de `appendSaleDeduction`.
 *
 * Coinciden estructuralmente con `InventoryPort` de `payments/inventory-port.ts`,
 * de modo que este almacén satisface el puerto **sin que `inventory/` importe de
 * `payments/`**: la dependencia apunta en un solo sentido, igual que en `CashPort`.
 */
export interface SaleDeductionInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly saleId: string;
  readonly presentationId: string;
  readonly quantity: string;
  readonly businessDate: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type SaleDeductionOutcome =
  | { readonly kind: "POSTED" }
  | { readonly kind: "IDEMPOTENT" }
  | { readonly kind: "INSUFFICIENT_STOCK"; readonly available: string };

/** Multi-output transform (despiece) on the shared lot ledger. */
export interface TransformOrderInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly canonicalMassUnit: "G" | "KG" | null;
  readonly inputs: ReadonlyArray<{
    readonly presentationId: string;
    readonly lotId: string;
    readonly quantity: string;
    readonly massQuantity: string | null;
  }>;
  readonly outputs: ReadonlyArray<{
    readonly presentationId: string;
    readonly quantity: string;
    readonly massQuantity: string | null;
    readonly batchCode: string;
  }>;
  readonly shrinkage: ReadonlyArray<{
    readonly presentationId: string;
    readonly lotId: string;
    readonly quantity: string;
    readonly massQuantity: string | null;
  }>;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type TransformOrderOutcome =
  | { readonly kind: "POSTED"; readonly orderId: string }
  | { readonly kind: "IDEMPOTENT"; readonly orderId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "INVALID_QUANTITY" }
  | { readonly kind: "MASS_RECONCILIATION_FAILED" }
  | { readonly kind: "LOT_NOT_FOUND" }
  | { readonly kind: "LOT_NOT_SELLABLE" }
  | { readonly kind: "LOT_RESERVED" }
  | { readonly kind: "INSUFFICIENT_STOCK"; readonly available: string }
  | { readonly kind: "PRESENTATION_NOT_FOUND" }
  | { readonly kind: "QUANTITY_PRECISION_EXCEEDED" }
  | { readonly kind: "LEGACY_STOCK_RECONCILIATION_REQUIRED" }
  | { readonly kind: "CONFLICT" };

export type AppendMovementOutcome =
  | { readonly kind: "POSTED"; readonly stockSequence: number; readonly quantityAfter: string }
  | { readonly kind: "IDEMPOTENT"; readonly stockSequence: number; readonly quantityAfter: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PRESENTATION_NOT_FOUND" }
  | { readonly kind: "INVALID_QUANTITY" }
  | { readonly kind: "QUANTITY_PRECISION_EXCEEDED" }
  | { readonly kind: "STOCK_QUANTITY_OVERFLOW" }
  | { readonly kind: "INSUFFICIENT_STOCK"; readonly available: string }
  | { readonly kind: "LOT_TRACKING_REQUIRED" }
  | { readonly kind: "LEGACY_STOCK_RECONCILIATION_REQUIRED" }
  | { readonly kind: "LOT_NOT_FOUND" }
  | { readonly kind: "LOT_NOT_SELLABLE" };

interface StockRow {
  quantity_on_hand: string;
  last_movement_sequence: number;
  version: number;
}
interface MovementRow {
  stock_sequence: number;
  quantity_after: string;
}
interface OperationRow { payload_checksum: string }
interface NextSequenceRow { next_sequence: number }

export class SqliteInventoryStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Lectura ────────────────────────────────────────────────────────────────

  /** Existencia actual. `null` cuando la presentación nunca tuvo movimiento en esta sucursal. */
  getStock(scope: InventoryScope, presentationId: string): InventoryStock | null {
    const row = this.database.native.prepare(
      `SELECT quantity_on_hand, last_movement_sequence, version FROM inventory_stock
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, presentationId) as StockRow | undefined;

    if (row === undefined) return null;
    return {
      presentationId,
      quantityOnHand: row.quantity_on_hand,
      lastMovementSequence: row.last_movement_sequence,
    };
  }

  /** Lot control is per company/branch/presentation; legacy registers stay unchanged. */
  isLotTracked(scope:InventoryScope,presentationId:string):boolean {
    return Boolean(this.database.native.prepare(
      "SELECT 1 FROM inventory_lot_tracking WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?"
    ).get(scope.tenantId,scope.companyId,scope.branchId,presentationId));
  }

  /** Physical/eligible units before subtracting ACTIVE reservations. */
  sellableUnits(scope:InventoryScope,presentationId:string,at:Date=this.now()):bigint {
    if(!this.isLotTracked(scope,presentationId)){
      const stock=this.getStock(scope,presentationId);
      return stock?scale6ToBigInt(stock.quantityOnHand):0n;
    }
    const today=at.toISOString().slice(0,10);
    const rows=this.database.native.prepare(`SELECT quantity_on_hand FROM inventory_lot
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?
        AND status='AVAILABLE' AND (expiry_date IS NULL OR expiry_date>=?)`)
      .all(scope.tenantId,scope.companyId,scope.branchId,presentationId,today) as Array<{quantity_on_hand:string}>;
    return rows.reduce((sum,row)=>sum+scale6ToBigInt(row.quantity_on_hand),0n);
  }

  /** Remaining quantity held by ACTIVE/PARTIALLY_CONSUMED reservations. */
  reservedUnits(scope:InventoryScope,presentationId:string):bigint {
    const rows=this.database.native.prepare(`SELECT quantity,consumed_quantity,released_quantity
      FROM inventory_reservation
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?
        AND status IN ('ACTIVE','PARTIALLY_CONSUMED')`)
      .all(scope.tenantId,scope.companyId,scope.branchId,presentationId) as Array<{
        quantity:string;consumed_quantity:string;released_quantity:string;
      }>;
    return rows.reduce((sum,row)=>{
      const held=scale6ToBigInt(row.quantity)-scale6ToBigInt(row.consumed_quantity)-scale6ToBigInt(row.released_quantity);
      return sum+(held>0n?held:0n);
    },0n);
  }

  private reservedUnitsForLot(scope:InventoryScope,lotId:string):bigint {
    const rows=this.database.native.prepare(`SELECT rl.quantity AS quantity
      FROM inventory_reservation_lot rl
      JOIN inventory_reservation r
        ON r.tenant_id=rl.tenant_id AND r.branch_id=rl.branch_id AND r.id=rl.reservation_id
      WHERE rl.tenant_id=? AND rl.company_id=? AND rl.branch_id=? AND rl.lot_id=?
        AND r.status IN ('ACTIVE','PARTIALLY_CONSUMED')`)
      .all(scope.tenantId,scope.companyId,scope.branchId,lotId) as Array<{quantity:string}>;
    return rows.reduce((sum,row)=>sum+scale6ToBigInt(row.quantity),0n);
  }

  private deductFefo(input:AppendMovementInput):{kind:"OK";lots:Array<{id:string;units:bigint}>}|
    {kind:"INSUFFICIENT_STOCK";available:string}{
    const today=this.now().toISOString().slice(0,10);
    const rows=this.database.native.prepare(`SELECT id,quantity_on_hand FROM inventory_lot
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?
       AND status='AVAILABLE' AND (expiry_date IS NULL OR expiry_date>=?)
      ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,
       expiry_date ASC, created_at ASC,id ASC`)
      .all(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.presentationId,today) as Array<{id:string;quantity_on_hand:string}>;
    let remaining=scale6ToBigInt(input.quantity);
    const lots:Array<{id:string;units:bigint}>=[];
    for(const row of rows){
      if(remaining===0n)break;
      const held=this.reservedUnitsForLot(input.scope,row.id);
      const possible=scale6ToBigInt(row.quantity_on_hand)-held;
      if(possible<=0n)continue;
      const taken=possible<remaining?possible:remaining;
      if(taken>0n){lots.push({id:row.id,units:taken});remaining-=taken;}
    }
    if(remaining>0n)return {kind:"INSUFFICIENT_STOCK",available:bigIntToScale6(scale6ToBigInt(input.quantity)-remaining)};
    return {kind:"OK",lots};
  }

  /** Batch ledger update is called only inside the SAME active SQLite transaction
   * as the pre-existing inventory_movement, operation/audit/outbox. */
  private writeLotLedger(input:AppendMovementInput,lotId:string,units:bigint,
    direction:"IN"|"OUT",eventType:"RECEIPT"|"SALE"|"SHRINKAGE"|"ADJUSTMENT"|"TRANSFER"|"CONVERSION"|"MATERIAL_CONSUMPTION",
    receipt?:{supplierReference:string;receiptDocument:string}):void {
    const row=this.database.native.prepare(`SELECT quantity_on_hand,version FROM inventory_lot
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=? AND presentation_id=?`)
      .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,lotId,input.presentationId) as
        {quantity_on_hand:string;version:number}|undefined;
    if(!row)throw Error("LOT_NOT_FOUND");
    const next=scale6ToBigInt(row.quantity_on_hand)+(direction==="IN"?units:-units);
    if(next<0n)throw Error("LOT_INSUFFICIENT_STOCK");
    const timestamp=this.now().toISOString();
    const written=this.database.native.prepare(`UPDATE inventory_lot
      SET quantity_on_hand=?,version=version+1,updated_at=?
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=? AND version=?`)
      .run(bigIntToScale6(next),timestamp,input.scope.tenantId,input.scope.companyId,
        input.scope.branchId,lotId,row.version);
    if(written.changes!==1)throw Error("LOT_CONCURRENT_MODIFICATION");
    this.database.native.prepare(`INSERT INTO inventory_lot_movement(
      tenant_id,company_id,branch_id,id,lot_id,inventory_movement_id,direction,
      quantity,quantity_after,event_type,actor_id,reason_code,supplier_reference,receipt_document,occurred_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.scope.tenantId,input.scope.companyId,input.scope.branchId,uuidV7(),
      lotId,input.movementId,direction,bigIntToScale6(units),bigIntToScale6(next),
      eventType,input.operatorUserId,input.reasonCode,
      receipt?.supplierReference??null,receipt?.receiptDocument??null,timestamp);
  }

  /**
   * Existencia disponible como entero de escala 6. Sin fila es cero.
   *
   * La venta la consulta antes de aceptar la línea: rechazar al crear es lo
   * único honesto, porque al completar el cliente ya pagó.
   */
  /** Sellable units minus durable ACTIVE reservations (physical stock unchanged). */
  availableUnits(scope: InventoryScope, presentationId: string): bigint {
    const sellable=this.sellableUnits(scope,presentationId);
    const reserved=this.reservedUnits(scope,presentationId);
    return sellable>reserved?sellable-reserved:0n;
  }

  // ── Escritura ──────────────────────────────────────────────────────────────

  /**
   * Asienta un movimiento y deja la existencia al día.
   *
   * **No abre transacción.** El descuento de la venta y el `COMPLETED` de esa
   * misma venta son un solo hecho y no pueden confirmarse por separado, igual
   * que el asiento de caja y el pago (`CashPort`). Quien llama aporta la
   * transacción; `receiveStock` y `adjustStock` la abren, y el puerto de la
   * venta se ejecuta dentro de la que ya está abierta.
   */
  appendMovement(
    input: AppendMovementInput,
    batchWrite=false,
    preAllocatedLots: Array<{id:string;units:bigint}>|null=null,
  ): AppendMovementOutcome {
    const nowIso = this.now().toISOString();

    const operation = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as OperationRow | undefined;

    if (operation !== undefined) {
      if (operation.payload_checksum !== input.requestChecksum) {
        return { kind: "IDEMPOTENCY_CONFLICT" };
      }
      const existing = this.database.native.prepare(
        "SELECT stock_sequence, quantity_after FROM inventory_movement WHERE tenant_id=? AND company_id=? AND branch_id=? AND idempotency_key=?",
      ).get(input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.idempotencyKey) as MovementRow | undefined;
      if (existing === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
      return {
        kind: "IDEMPOTENT",
        stockSequence: existing.stock_sequence,
        quantityAfter: existing.quantity_after,
      };
    }

    // La existencia cuelga de una presentación real: sin esta comprobación el
    // fallo llegaría como violación de clave foránea, que no dice qué pasó.
    const presentation = this.database.native.prepare(
      `SELECT cp.id, cp.unit_precision FROM catalog_presentation cp
       JOIN catalog_product p ON p.tenant_id=cp.tenant_id AND p.id=cp.product_id
       WHERE cp.tenant_id=? AND p.company_id=? AND cp.id=?`,
    ).get(input.scope.tenantId, input.scope.companyId, input.presentationId) as { id: string; unit_precision: number } | undefined;
    if (presentation === undefined) return { kind: "PRESENTATION_NOT_FOUND" };
    // The same published presentation precision governs receipts, shrinkage and sales.
    // Reject rather than round: a fraction of a unit must never silently become stock.
    if (!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity) || scale6ToBigInt(input.quantity) <= 0n) {
      return { kind: "INVALID_QUANTITY" };
    }
    if (!quantityFitsUnitPrecision(input.quantity, presentation.unit_precision)) {
      return { kind: "QUANTITY_PRECISION_EXCEEDED" };
    }

    const tracked=this.isLotTracked(input.scope,input.presentationId);
    if(tracked && input.movementType!=="SALE"&&!batchWrite)
      return {kind:"LOT_TRACKING_REQUIRED"};
    const fefo=tracked&&input.movementType==="SALE"
      ?(preAllocatedLots!==null
        ?{kind:"OK" as const,lots:preAllocatedLots}
        :this.deductFefo(input))
      :null;
    if(fefo?.kind==="INSUFFICIENT_STOCK")return fefo;

    const current = this.database.native.prepare(
      `SELECT quantity_on_hand, last_movement_sequence, version FROM inventory_stock
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?`,
    ).get(input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.presentationId) as StockRow | undefined;

    const currentUnits = current === undefined ? 0n : scale6ToBigInt(current.quantity_on_hand);
    const quantityUnits = scale6ToBigInt(input.quantity);
    const direction = movementDirection(input.movementType);
    const afterUnits = direction === "IN" ? currentUnits + quantityUnits : currentUnits - quantityUnits;

    // Una existencia negativa no se puede escribir —el `GLOB` de la columna no
    // admite signo—, pero llegar hasta el `INSERT` para enterarse convertiría un
    // error de negocio en una excepción de SQLite sin diagnóstico.
    if (afterUnits < 0n) {
      return { kind: "INSUFFICIENT_STOCK", available: bigIntToScale6(currentUnits) };
    }

    if (afterUnits > 9_999_999_999_999_999_999n) return { kind: "STOCK_QUANTITY_OVERFLOW" };
    const quantityAfter = bigIntToScale6(afterUnits);
    const stockSequence = (current === undefined ? 0 : current.last_movement_sequence) + 1;

    this.database.native.prepare(
      `INSERT INTO inventory_movement(
        id, tenant_id, company_id, branch_id, presentation_id, stock_sequence,
        movement_type, direction, quantity, quantity_after, reason_code, sale_id,
        actor_type, actor_id, operation_id, idempotency_key, correlation_id,
        business_date, occurred_at, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'USER',?,?,?,?,?,?,?)`,
    ).run(
      input.movementId, input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.presentationId, stockSequence,
      input.movementType, direction, input.quantity, quantityAfter,
      input.reasonCode, input.saleId,
      input.operatorUserId, input.operationId, input.idempotencyKey, input.correlationId,
      input.businessDate, nowIso, nowIso,
    );

    if (current === undefined) {
      this.database.native.prepare(
        `INSERT INTO inventory_stock(
          tenant_id, company_id, branch_id, presentation_id,
          quantity_on_hand, last_movement_sequence, version, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,1,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.presentationId,
        quantityAfter, stockSequence, nowIso, nowIso,
      );
    } else {
      // La versión esperada en el `WHERE` impide que dos escrituras concurrentes
      // se pisen: la segunda no encuentra fila que actualizar.
      const updated = this.database.native.prepare(
        `UPDATE inventory_stock
         SET quantity_on_hand=?, last_movement_sequence=?, version=version+1, updated_at=?
         WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=? AND version=?`,
      ).run(
        quantityAfter, stockSequence, nowIso,
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.presentationId, current.version,
      );
      if (updated.changes !== 1) {
        throw new Error("inventory stock row changed during the transaction");
      }
    }

    this.database.native.prepare(
      `INSERT INTO runtime_operations(
        operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
       VALUES (?,?,?,'SUCCEEDED','POSTED',?,?)`,
    ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);

    // Auditoría: quién movió qué, en qué dirección y por qué. El motivo es el
    // dato que convierte un ajuste en algo revisable en lugar de en un agujero.
    this.database.native.prepare(
      `INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id,
        actor_type, actor_id, session_id,
        action_code, resource_type, resource_id,
        correlation_id, causation_id, reason_code, details_json, created_at
      ) VALUES (?,?,?,?,'USER',?,?,'INVENTORY_MOVEMENT_APPEND','INVENTORY_MOVEMENT',?,?,?,?,?,?)`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
      input.operatorUserId, input.sessionId,
      input.movementId, input.correlationId, input.causationId, input.reasonCode,
      canonicalJson({
        presentation_id: input.presentationId,
        movement_type: input.movementType,
        direction,
        quantity: input.quantity,
        quantity_after: quantityAfter,
        sale_id: input.saleId,
      }),
      nowIso,
    );

    if(fefo?.kind==="OK"){
      for(const entry of fefo.lots)this.writeLotLedger(input,entry.id,entry.units,"OUT","SALE");
    }

    this.enqueue(input, direction, quantityAfter, stockSequence, nowIso,
      fefo?.kind==="OK"?fefo.lots:null);

    return { kind: "POSTED", stockSequence, quantityAfter };
  }

  private enqueue(
    input: AppendMovementInput,
    direction: "IN" | "OUT",
    quantityAfter: string,
    stockSequence: number,
    nowIso: string,
    lotAllocations: Array<{id:string;units:bigint}>|null=null,
  ): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.scope.deviceId, input.scope.installationId,
    ) as NextSequenceRow).next_sequence;

    this.durableSync.enqueue({
      operation_id: input.operationId,
      tenant_id: input.scope.tenantId,
      company_id: input.scope.companyId,
      branch_id: input.scope.branchId,
      device_id: input.scope.deviceId,
      installation_id: input.scope.installationId,
      session_id: input.sessionId,
      actor_id: input.operatorUserId,
      aggregate_type: "INVENTORY_STOCK",
      aggregate_id: input.presentationId,
      operation_type: "INVENTORY_MOVEMENT_APPEND",
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: input.idempotencyKey,
      expected_version: null,
      payload_schema_version: INVENTORY_PAYLOAD_SCHEMA_VERSION,
      payload: {
        movement_id: input.movementId,
        presentation_id: input.presentationId,
        movement_type: input.movementType,
        direction,
        quantity: input.quantity,
        quantity_after: quantityAfter,
        stock_sequence: stockSequence,
        reason_code: input.reasonCode,
        sale_id: input.saleId,
        business_date: input.businessDate,
        // Local identity of FEFO/reservation lots for Central consumption when
        // a typed lot-sync contract exists. Not a Central ACK.
        lot_allocations: lotAllocations===null?null:lotAllocations.map((entry)=>({
          lot_id: entry.id,
          quantity: bigIntToScale6(entry.units),
        })),
      },
      payload_checksum: input.requestChecksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }

  /**
   * Salida por venta — satisface `InventoryPort` de `payments/`.
   *
   * Se ejecuta **dentro** de la transacción que completa la venta; por eso no
   * abre la suya. La clave de idempotencia es `(venta, presentación)`: una
   * finalización reintentada no descuenta dos veces, y una presentación que
   * aparece en dos líneas de la misma venta se descuenta una sola vez con la
   * cantidad ya sumada por quien llama.
   */
  appendSaleDeduction(input: SaleDeductionInput): SaleDeductionOutcome {
    const idempotencyKey = `inventory_sale:${input.saleId}:${input.presentationId}`;
    const requestChecksum = createHash("sha256")
      .update(canonicalJson({
        presentation_id: input.presentationId,
        quantity: input.quantity,
        sale_id: input.saleId,
      }))
      .digest("hex");

    const reservation=this.findActiveSaleReservation(
      input.scope,input.saleId,input.presentationId);
    // P0: revalidate bound FEFO lots before confirming payment stock exit.
    // A hold created earlier must still match scope, quantity, eligibility and
    // physical on-hand; otherwise the payment transaction must roll back.
    let preAllocated: Array<{id:string;units:bigint}>|null=null;
    if(reservation!==null){
      const validated=this.validateReservationForSaleDeduction(
        input.scope,reservation,input.presentationId,input.quantity);
      if(validated.kind==="REJECTED"){
        return {kind:"INSUFFICIENT_STOCK",available:validated.available};
      }
      preAllocated=validated.lots;
    }

    const outcome = this.appendMovement({
      scope: input.scope,
      sessionId: input.sessionId,
      operatorUserId: input.operatorUserId,
      movementId: randomUUID(),
      operationId: uuidV7(),
      presentationId: input.presentationId,
      movementType: "SALE",
      quantity: input.quantity,
      reasonCode: "SALE_COMPLETED",
      saleId: input.saleId,
      businessDate: input.businessDate,
      idempotencyKey,
      requestChecksum,
      correlationId: input.correlationId,
      causationId: input.causationId,
    }, false, preAllocated);

    if(outcome.kind==="POSTED" && reservation!==null){
      this.markReservationConsumed({
        scope:input.scope,sessionId:input.sessionId,actorId:input.operatorUserId,
        reservationId:reservation.id,quantity:input.quantity,
        correlationId:input.correlationId,causationId:input.causationId,
        saleId:input.saleId,presentationId:input.presentationId,
      });
    }

    switch (outcome.kind) {
      case "POSTED":
        return { kind: "POSTED" };
      case "IDEMPOTENT":
        return { kind: "IDEMPOTENT" };
      case "INSUFFICIENT_STOCK":
        return { kind: "INSUFFICIENT_STOCK", available: outcome.available };
      // `IDEMPOTENCY_CONFLICT` significaría que la misma venta y presentación
      // se están descontando con una cantidad distinta, y `PRESENTATION_NOT_FOUND`
      // que la venta referencia algo que no está en el catálogo. Ninguna de las
      // dos es un caso de negocio: son estados imposibles si la venta se creó
      // por el camino normal, y silenciarlos dejaría existencia sin descontar.
      default:
        throw new Error(`inventory sale deduction failed: ${outcome.kind}`);
    }
  }

  /**
   * Documented receiving within the original inventory transaction.
   * No automatic migration of historical stock to an invented batch.
   */
  receiveBatch(input:AppendMovementInput,batch:{
    code:string;manufactureDate:string|null;expiryDate:string|null;
    supplierReference:string;receiptDocument:string;
  }):AppendMovementOutcome {
    if(input.movementType!=="PURCHASE_RECEIPT")throw Error("LOT_RECEIPT_TYPE_REQUIRED");
    const validDate=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&
      !Number.isNaN(Date.parse(x))&&new Date(x+"T00:00:00.000Z").toISOString().slice(0,10)===x;
    if(batch.code.trim().length<1||batch.code.length>96||batch.supplierReference.trim().length<1||
      batch.supplierReference.length>160||batch.receiptDocument.trim().length<1||
      batch.receiptDocument.length>160||(batch.manufactureDate!==null&&!validDate(batch.manufactureDate))||
      (batch.expiryDate!==null&&!validDate(batch.expiryDate))||
      (batch.expiryDate!==null&&batch.manufactureDate!==null&&batch.manufactureDate>batch.expiryDate))
      return {kind:"INVALID_QUANTITY"};
    if(!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity)||scale6ToBigInt(input.quantity)<=0n)
      return {kind:"INVALID_QUANTITY"};
    const check=()=>{
      const tracking=this.isLotTracked(input.scope,input.presentationId);
      if(!tracking&&this.availableUnits(input.scope,input.presentationId)!==0n)
        return {kind:"LEGACY_STOCK_RECONCILIATION_REQUIRED"} as AppendMovementOutcome;
      // Same account of a repeated receipt cannot alter supplier/document/lot.
      const existing=this.database.native.prepare(`SELECT payload_checksum FROM runtime_operations
        WHERE idempotency_key=?`).get(input.idempotencyKey) as {payload_checksum:string}|undefined;
      if(existing)return this.appendMovement(input,true);
      const posted=this.appendMovement(input,true);
      if(posted.kind!=="POSTED")return posted;
      const nowIso=this.now().toISOString();
      if(!tracking)this.database.native.prepare(`INSERT INTO inventory_lot_tracking
        (tenant_id,company_id,branch_id,presentation_id,enabled_at,actor_id)
        VALUES(?,?,?,?,?,?)`).run(input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          input.presentationId,nowIso,input.operatorUserId);
      let lot=this.database.native.prepare(`SELECT id,manufacture_date,expiry_date FROM inventory_lot
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=? AND batch_code=?`)
        .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.presentationId,batch.code) as
          {id:string;manufacture_date:string|null;expiry_date:string|null}|undefined;
      if(lot&&(lot.manufacture_date!==batch.manufactureDate||lot.expiry_date!==batch.expiryDate))
        throw Error("LOT_METADATA_CONFLICT");
      if(!lot){
        const id=uuidV7();
        this.database.native.prepare(`INSERT INTO inventory_lot(
          id,tenant_id,company_id,branch_id,presentation_id,batch_code,manufacture_date,
          expiry_date,supplier_reference,receipt_document,status,quantity_on_hand,version,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,'AVAILABLE','0.000000',1,?,?)`).run(
          id,input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.presentationId,
          batch.code,batch.manufactureDate,batch.expiryDate,batch.supplierReference,
          batch.receiptDocument,nowIso,nowIso);
        lot={id,manufacture_date:batch.manufactureDate,expiry_date:batch.expiryDate};
      }
      this.writeLotLedger(input,lot.id,scale6ToBigInt(input.quantity),"IN","RECEIPT",
        {supplierReference:batch.supplierReference,receiptDocument:batch.receiptDocument});
      return posted;
    };
    return this.database.native.transaction(check)();
  }

  /** Lot-specific shrinkage / inventory adjustment (no hidden conversion).
   * Only the existing authorized adjustment use case may call this method.
   * Both books, audit and outbox commit or roll back as one transaction. */
  debitBatch(input:AppendMovementInput,lotId:string):AppendMovementOutcome {
    if(!["SHRINKAGE","ADJUSTMENT_NEGATIVE","TRANSFER_OUT"].includes(input.movementType))
      throw Error("LOT_DEBIT_MOVEMENT_NOT_ALLOWED");
    return this.database.native.transaction(()=>{
      if(!this.isLotTracked(input.scope,input.presentationId))
        return {kind:"LOT_TRACKING_REQUIRED"} as AppendMovementOutcome;
      // The original request has already been durably applied. Return the
      // persisted outcome before re-checking a stock or eligibility state that
      // may have changed since that commit. Conflicting payloads still fail.
      const previous=this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?"
      ).get(input.idempotencyKey) as OperationRow|undefined;
      if(previous)return this.appendMovement(input,true);
      const record=this.database.native.prepare(`SELECT quantity_on_hand,status,expiry_date FROM inventory_lot
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=? AND id=?`)
        .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          input.presentationId,lotId) as {quantity_on_hand:string;status:string;expiry_date:string|null}|undefined;
      if(!record)return {kind:"LOT_NOT_FOUND"} as AppendMovementOutcome;
      // Recipe/raw-material consumption is a productive use, not disposal.
      // Quarantine, recall and expiry must never enter a finished product.
      // Physical loss/withdrawal from those lots remains possible with SHRINKAGE.
      if(input.reasonCode==="MATERIAL_CONSUMPTION" &&
        (record.status!=="AVAILABLE" ||
         (record.expiry_date!==null && record.expiry_date<this.now().toISOString().slice(0,10))))
        return {kind:"LOT_NOT_SELLABLE"} as AppendMovementOutcome;
      if(!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity)||scale6ToBigInt(input.quantity)<=0n)
        return {kind:"INVALID_QUANTITY"} as AppendMovementOutcome;
      const free=scale6ToBigInt(record.quantity_on_hand)-this.reservedUnitsForLot(input.scope,lotId);
      if(free<scale6ToBigInt(input.quantity))
        return {kind:"INSUFFICIENT_STOCK",available:bigIntToScale6(free>0n?free:0n)} as AppendMovementOutcome;
      const result=this.appendMovement(input,true);
      if(result.kind!=="POSTED")return result;
      const entryType=input.movementType==="SHRINKAGE"?"SHRINKAGE":
        input.movementType==="TRANSFER_OUT"?"TRANSFER":
        input.reasonCode==="MATERIAL_CONSUMPTION"?"MATERIAL_CONSUMPTION":"ADJUSTMENT";
      this.writeLotLedger(input,lotId,scale6ToBigInt(input.quantity),"OUT",entryType);
      return result;
    })();
  }

  /** Read batch-specific physical balances without merging branch inventory. */
  listBatches(scope:InventoryScope,presentationId:string):Array<{
    id:string;batchCode:string;quantityOnHand:string;status:string;
    manufactureDate:string|null;expiryDate:string|null;
    supplierReference:string;receiptDocument:string;
  }>{
    const rows=this.database.native.prepare(`SELECT id,batch_code,quantity_on_hand,status,
      manufacture_date,expiry_date,supplier_reference,receipt_document
      FROM inventory_lot WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?
      ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,
      expiry_date ASC,created_at ASC,id ASC`)
      .all(scope.tenantId,scope.companyId,scope.branchId,presentationId) as Array<{
        id:string;batch_code:string;quantity_on_hand:string;status:string;
        manufacture_date:string|null;expiry_date:string|null;
        supplier_reference:string;receipt_document:string;
      }>;
    return rows.map(row=>({
      id:row.id,batchCode:row.batch_code,quantityOnHand:row.quantity_on_hand,
      status:row.status,manufactureDate:row.manufacture_date,expiryDate:row.expiry_date,
      supplierReference:row.supplier_reference,receiptDocument:row.receipt_document,
    }));
  }

  /** A mutable lot status always has an immutable audit event and a checksum. */
  changeBatchStatus(input:{
    scope:SyncScope;lotId:string;status:"AVAILABLE"|"QUARANTINE"|"BLOCKED"|"RECALLED";
    sessionId?:string;correlationId?:string;causationId?:string|null;
    actorId:string;reasonCode:string;idempotencyKey:string;requestChecksum:string;
  }):"UPDATED"|"IDEMPOTENT"|"CONFLICT"|"NOT_FOUND" {
    return this.database.native.transaction(()=>{
      const duplicate=this.database.native.prepare(`SELECT request_checksum FROM inventory_lot_status_event
        WHERE tenant_id=? AND idempotency_key=?`).get(input.scope.tenantId,input.idempotencyKey) as
          {request_checksum:string}|undefined;
      if(duplicate)return duplicate.request_checksum===input.requestChecksum?"IDEMPOTENT":"CONFLICT";
      if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.reasonCode)||
        !/^[a-f0-9]{64}$/.test(input.requestChecksum))return "CONFLICT";
      const row=this.database.native.prepare(`SELECT status,version FROM inventory_lot
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`)
        .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.lotId) as
          {status:string;version:number}|undefined;
      if(!row)return "NOT_FOUND";
      if(row.status===input.status)return "CONFLICT";
      // Recalled stock cannot be silently released; a real recall requires a
      // documented compliance disposition outside normal stock adjustments.
      if(row.status==="RECALLED"&&input.status==="AVAILABLE")return "CONFLICT";
      const when=this.now().toISOString();
      const updated=this.database.native.prepare(`UPDATE inventory_lot SET status=?,version=version+1,updated_at=?
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=? AND version=?`).run(
        input.status,when,input.scope.tenantId,input.scope.companyId,input.scope.branchId,
        input.lotId,row.version);
      if(updated.changes!==1)throw Error("LOT_CONCURRENT_MODIFICATION");
      this.database.native.prepare(`INSERT INTO inventory_lot_status_event(
        tenant_id,company_id,branch_id,id,lot_id,previous_status,next_status,
        actor_id,reason_code,idempotency_key,request_checksum,occurred_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.scope.tenantId,input.scope.companyId,
        input.scope.branchId,uuidV7(),input.lotId,row.status,input.status,input.actorId,
        input.reasonCode,input.idempotencyKey,input.requestChecksum,when);
      if(input.sessionId&&input.correlationId){
        this.database.native.prepare(`INSERT INTO local_operation_audit(
          tenant_id,company_id,branch_id,device_id,actor_type,actor_id,session_id,
          action_code,resource_type,resource_id,correlation_id,causation_id,
          reason_code,details_json,created_at
        ) VALUES(?,?,?,?,'USER',?,?,'INVENTORY_LOT_STATUS_CHANGED','INVENTORY_LOT',?,?,?,?,?,?)`)
          .run(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.scope.deviceId,
            input.actorId,input.sessionId,input.lotId,input.correlationId,
            input.causationId??null,input.reasonCode,
            canonicalJson({previous_status:row.status,next_status:input.status}),when);
      }
      return "UPDATED";
    })();
  }


  /**
   * Approves an immutable, versioned, same-product presentation equivalence.
   * Numerator/denominator measure TARGET units per SOURCE unit, not money.
   * Only an authorized application use case may call this method.
   */
  approveConversionRule(input:{
    scope:SyncScope;sourcePresentationId:string;targetPresentationId:string;
    numerator:string;denominator:string;version:number;actorId:string;
    sessionId:string;idempotencyKey:string;requestChecksum:string;
    correlationId:string;causationId:string|null;
  }):{kind:"APPROVED"|"IDEMPOTENT"|"CONFLICT"|"PRESENTATION_NOT_FOUND";ruleId?:string}{
    const numeric=(v:string)=>/^[1-9][0-9]{0,11}$/.test(v);
    if(!numeric(input.numerator)||!numeric(input.denominator)||
       !Number.isSafeInteger(input.version)||input.version<1||
       input.sourcePresentationId===input.targetPresentationId)
      return {kind:"CONFLICT"};
    return this.database.native.transaction(()=>{
      const prior=this.database.native.prepare(`SELECT id,request_checksum
        FROM inventory_conversion_rule WHERE tenant_id=? AND idempotency_key=?`)
        .get(input.scope.tenantId,input.idempotencyKey) as
          {id:string;request_checksum:string}|undefined;
      if(prior)return prior.request_checksum===input.requestChecksum
        ?{kind:"IDEMPOTENT" as const,ruleId:prior.id}:{kind:"CONFLICT" as const};
      const rows=this.database.native.prepare(`SELECT cp.id,cp.product_id,cp.status
        FROM catalog_presentation cp JOIN catalog_product p
          ON p.tenant_id=cp.tenant_id AND p.id=cp.product_id
        WHERE cp.tenant_id=? AND p.company_id=? AND p.status='ACTIVE'
          AND cp.id IN (?,?)`).all(input.scope.tenantId,input.scope.companyId,
          input.sourcePresentationId,input.targetPresentationId) as
        Array<{id:string;product_id:string;status:string}>;
      if(rows.length!==2||rows.some(x=>x.status!=="ACTIVE")||
         rows[0]!.product_id!==rows[1]!.product_id)
        return {kind:"PRESENTATION_NOT_FOUND" as const};
      const existing=this.database.native.prepare(`SELECT 1 FROM inventory_conversion_rule
        WHERE tenant_id=? AND company_id=? AND source_presentation_id=?
          AND target_presentation_id=? AND version=?`).get(
          input.scope.tenantId,input.scope.companyId,input.sourcePresentationId,
          input.targetPresentationId,input.version);
      if(existing)return {kind:"CONFLICT" as const};
      const ruleId=uuidV7(),when=this.now().toISOString();
      this.database.native.prepare(`INSERT INTO inventory_conversion_rule(
        tenant_id,company_id,id,product_id,source_presentation_id,target_presentation_id,
        numerator,denominator,version,approved_by,idempotency_key,request_checksum,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.scope.tenantId,input.scope.companyId,ruleId,rows[0]!.product_id,
        input.sourcePresentationId,input.targetPresentationId,input.numerator,
        input.denominator,input.version,input.actorId,input.idempotencyKey,
        input.requestChecksum,when);
      this.database.native.prepare(`INSERT INTO local_operation_audit(
        tenant_id,company_id,branch_id,device_id,actor_type,actor_id,session_id,
        action_code,resource_type,resource_id,correlation_id,causation_id,
        reason_code,details_json,created_at
      ) VALUES(?,?,?,?,'USER',?,?,'INVENTORY_CONVERSION_RULE_APPROVED',
        'INVENTORY_CONVERSION_RULE',?,?,?,?,?,?)`).run(
        input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.scope.deviceId,
        input.actorId,input.sessionId,ruleId,input.correlationId,input.causationId,
        "CONVERSION_RULE_APPROVAL",canonicalJson({
          source_presentation_id:input.sourcePresentationId,
          target_presentation_id:input.targetPresentationId,
          numerator:input.numerator,denominator:input.denominator,version:input.version,
        }),when);
      return {kind:"APPROVED" as const,ruleId};
    })();
  }

  /**
   * In one SQLite writer transaction: debit exactly one eligible source batch,
   * credit one provenance-linked target batch, append both existing stock books,
   * local audit/outbox, and immutable conversion genealogy. No stock duplication.
   */
  convertPresentation(input:{
    scope:SyncScope;ruleId:string;sourceLotId:string;quantity:string;
    actorId:string;sessionId:string;idempotencyKey:string;requestChecksum:string;
    reasonCode:string;businessDate:string;correlationId:string;causationId:string|null;
  }):{kind:"CONVERTED"|"IDEMPOTENT"|"CONFLICT"|"RULE_NOT_FOUND"|"LOT_NOT_FOUND"|
    "LOT_NOT_SELLABLE"|"INSUFFICIENT_STOCK"|"INVALID_QUANTITY"|
    "QUANTITY_PRECISION_EXCEEDED"|"LEGACY_STOCK_RECONCILIATION_REQUIRED"|
    "STOCK_QUANTITY_OVERFLOW";conversionId?:string;targetLotId?:string;targetQuantity?:string}{
    type Result=ReturnType<SqliteInventoryStore["convertPresentation"]>;
    class AbortConversion extends Error{constructor(readonly result:Result){super("CONVERSION_ABORTED");}}
    const abort=(kind:Result["kind"]):never=>{throw new AbortConversion({kind});};
    try{return this.database.native.transaction(():Result=>{
      const prior=this.database.native.prepare(`SELECT id,target_lot_id,target_quantity,request_checksum
        FROM inventory_conversion_event WHERE tenant_id=? AND idempotency_key=?`)
        .get(input.scope.tenantId,input.idempotencyKey) as
          {id:string;target_lot_id:string;target_quantity:string;request_checksum:string}|undefined;
      if(prior)return prior.request_checksum===input.requestChecksum
        ?{kind:"IDEMPOTENT",conversionId:prior.id,targetLotId:prior.target_lot_id,
           targetQuantity:prior.target_quantity}:{kind:"CONFLICT"};
      if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.reasonCode)||
         !/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity))
        return {kind:"INVALID_QUANTITY"};
      const sourceUnits=scale6ToBigInt(input.quantity);
      if(sourceUnits<=0n)return {kind:"INVALID_QUANTITY"};
      const rule=this.database.native.prepare(`SELECT source_presentation_id,target_presentation_id,
        numerator,denominator,version FROM inventory_conversion_rule
        WHERE tenant_id=? AND company_id=? AND id=?`).get(
          input.scope.tenantId,input.scope.companyId,input.ruleId) as {
          source_presentation_id:string;target_presentation_id:string;
          numerator:string;denominator:string;version:number;
        }|undefined;
      if(!rule)return {kind:"RULE_NOT_FOUND"};
      // A newer approved equivalence supersedes an older immutable version.
      // Historic conversions remain linked to their original approved rule.
      const latest=this.database.native.prepare(`SELECT max(version) AS version
        FROM inventory_conversion_rule WHERE tenant_id=? AND company_id=?
        AND source_presentation_id=? AND target_presentation_id=?`).get(
          input.scope.tenantId,input.scope.companyId,
          rule.source_presentation_id,rule.target_presentation_id) as {version:number};
      if(latest.version!==rule.version)return {kind:"CONFLICT"};
      const precisionRows=this.database.native.prepare(`SELECT id,unit_precision FROM catalog_presentation
        WHERE tenant_id=? AND id IN (?,?) AND status='ACTIVE'`).all(
          input.scope.tenantId,rule.source_presentation_id,rule.target_presentation_id) as
        Array<{id:string;unit_precision:number}>;
      if(precisionRows.length!==2)return {kind:"RULE_NOT_FOUND"};
      const sourcePrecision=precisionRows.find(x=>x.id===rule.source_presentation_id)!.unit_precision;
      const targetPrecision=precisionRows.find(x=>x.id===rule.target_presentation_id)!.unit_precision;
      if(!quantityFitsUnitPrecision(input.quantity,sourcePrecision))
        return {kind:"QUANTITY_PRECISION_EXCEEDED"};
      const raw=sourceUnits*BigInt(rule.numerator),denominator=BigInt(rule.denominator);
      if(raw%denominator!==0n)return {kind:"QUANTITY_PRECISION_EXCEEDED"};
      const targetUnits=raw/denominator;
      if(targetUnits<=0n||targetUnits>9_999_999_999_999_999_999n)
        return {kind:"STOCK_QUANTITY_OVERFLOW"};
      const targetQuantity=bigIntToScale6(targetUnits);
      if(!quantityFitsUnitPrecision(targetQuantity,targetPrecision))
        return {kind:"QUANTITY_PRECISION_EXCEEDED"};
      const source=this.database.native.prepare(`SELECT batch_code,manufacture_date,expiry_date,
        supplier_reference,receipt_document,status,quantity_on_hand FROM inventory_lot
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=? AND id=?`)
        .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          rule.source_presentation_id,input.sourceLotId) as {
          batch_code:string;manufacture_date:string|null;expiry_date:string|null;
          supplier_reference:string;receipt_document:string;status:string;
          quantity_on_hand:string;
        }|undefined;
      if(!source)return {kind:"LOT_NOT_FOUND"};
      if(source.status!=="AVAILABLE"||
         (source.expiry_date!==null&&source.expiry_date<this.now().toISOString().slice(0,10)))
        return {kind:"LOT_NOT_SELLABLE"};
      const freeSource=scale6ToBigInt(source.quantity_on_hand)-this.reservedUnitsForLot(input.scope,input.sourceLotId);
      if(freeSource<sourceUnits)return {kind:"INSUFFICIENT_STOCK"};
      const destinationStock=this.getStock(input.scope,rule.target_presentation_id);
      if(!this.isLotTracked(input.scope,rule.target_presentation_id)&&
         destinationStock&&scale6ToBigInt(destinationStock.quantityOnHand)>0n)
        return {kind:"LEGACY_STOCK_RECONCILIATION_REQUIRED"};
      if(destinationStock&&
         scale6ToBigInt(destinationStock.quantityOnHand)+targetUnits>9_999_999_999_999_999_999n)
        return {kind:"STOCK_QUANTITY_OVERFLOW"};
      const code=`CV-${input.sourceLotId}`,when=this.now().toISOString();
      const existingDest=this.database.native.prepare(`SELECT id,status,manufacture_date,expiry_date
        FROM inventory_lot WHERE tenant_id=? AND company_id=? AND branch_id=?
          AND presentation_id=? AND batch_code=?`).get(
          input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          rule.target_presentation_id,code) as {
          id:string;status:string;manufacture_date:string|null;expiry_date:string|null;
        }|undefined;
      if(existingDest&&
         (existingDest.status!=="AVAILABLE"||
          existingDest.manufacture_date!==source.manufacture_date||
          existingDest.expiry_date!==source.expiry_date))return {kind:"LOT_NOT_SELLABLE"};
      if(!this.isLotTracked(input.scope,rule.target_presentation_id))
        this.database.native.prepare(`INSERT INTO inventory_lot_tracking(
          tenant_id,company_id,branch_id,presentation_id,enabled_at,actor_id)
          VALUES(?,?,?,?,?,?)`).run(input.scope.tenantId,input.scope.companyId,
          input.scope.branchId,rule.target_presentation_id,when,input.actorId);
      const targetLotId=existingDest?.id??uuidV7();
      if(!existingDest)this.database.native.prepare(`INSERT INTO inventory_lot(
        id,tenant_id,company_id,branch_id,presentation_id,batch_code,manufacture_date,
        expiry_date,supplier_reference,receipt_document,status,quantity_on_hand,version,
        created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'AVAILABLE','0.000000',1,?,?)`).run(
          targetLotId,input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          rule.target_presentation_id,code,source.manufacture_date,source.expiry_date,
          source.supplier_reference,source.receipt_document,when,when);
      const checksum=(leg:"OUT"|"IN")=>createHash("sha256").update(
        canonicalJson({conversion_checksum:input.requestChecksum,leg})).digest("hex");
      const base={scope:input.scope,sessionId:input.sessionId,operatorUserId:input.actorId,
        reasonCode:input.reasonCode,saleId:null,businessDate:input.businessDate,
        correlationId:input.correlationId,causationId:input.causationId};
      const out:AppendMovementInput={...base,movementId:uuidV7(),operationId:uuidV7(),
        presentationId:rule.source_presentation_id,movementType:"TRANSFER_OUT",
        quantity:input.quantity,idempotencyKey:`conversion:${input.idempotencyKey}:out`,
        requestChecksum:checksum("OUT")};
      const inbound:AppendMovementInput={...base,movementId:uuidV7(),operationId:uuidV7(),
        presentationId:rule.target_presentation_id,movementType:"TRANSFER_IN",
        quantity:targetQuantity,idempotencyKey:`conversion:${input.idempotencyKey}:in`,
        requestChecksum:checksum("IN")};
      const debited=this.appendMovement(out,true);
      if(debited.kind!=="POSTED")abort("CONFLICT");
      this.writeLotLedger(out,input.sourceLotId,sourceUnits,"OUT","CONVERSION");
      const credited=this.appendMovement(inbound,true);
      if(credited.kind!=="POSTED")abort("CONFLICT");
      this.writeLotLedger(inbound,targetLotId,targetUnits,"IN","CONVERSION");
      const conversionId=uuidV7();
      this.database.native.prepare(`INSERT INTO inventory_conversion_event(
        tenant_id,company_id,branch_id,id,rule_id,source_lot_id,target_lot_id,
        source_movement_id,target_movement_id,source_quantity,target_quantity,
        idempotency_key,request_checksum,actor_id,reason_code,occurred_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.scope.tenantId,input.scope.companyId,input.scope.branchId,conversionId,
        input.ruleId,input.sourceLotId,targetLotId,out.movementId,inbound.movementId,
        input.quantity,targetQuantity,input.idempotencyKey,input.requestChecksum,
        input.actorId,input.reasonCode,when);
      return {kind:"CONVERTED",conversionId,targetLotId,targetQuantity};
    })();}catch(error){if(error instanceof AbortConversion)return error.result;throw error;}
  }

  private findActiveSaleReservation(
    scope:InventoryScope,saleId:string,presentationId:string,
  ):{id:string;quantity:string;consumed_quantity:string;released_quantity:string}|null {
    const row=this.database.native.prepare(`SELECT id,quantity,consumed_quantity,released_quantity
      FROM inventory_reservation
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=?
        AND reference_type='SALE' AND reference_id=? AND status IN ('ACTIVE','PARTIALLY_CONSUMED')
      ORDER BY created_at ASC,id ASC LIMIT 1`)
      .get(scope.tenantId,scope.companyId,scope.branchId,presentationId,saleId) as
        {id:string;quantity:string;consumed_quantity:string;released_quantity:string}|undefined;
    return row??null;
  }

  private reservationLotAllocations(
    scope:InventoryScope,reservationId:string,
  ):Array<{id:string;units:bigint}> {
    const rows=this.database.native.prepare(`SELECT lot_id,quantity FROM inventory_reservation_lot
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND reservation_id=?
      ORDER BY lot_id ASC`)
      .all(scope.tenantId,scope.companyId,scope.branchId,reservationId) as Array<{
        lot_id:string;quantity:string;
      }>;
    return rows.map((row)=>({id:row.lot_id,units:scale6ToBigInt(row.quantity)}));
  }

  /**
   * P0 payment gate: a SALE hold may only debit its pre-allocated lots when
   * quantity, scope, lot eligibility and physical on-hand still match.
   */
  private validateReservationForSaleDeduction(
    scope:InventoryScope,
    reservation:{id:string;quantity:string;consumed_quantity:string;released_quantity:string},
    presentationId:string,
    quantity:string,
  ):{kind:"OK";lots:Array<{id:string;units:bigint}>}|{kind:"REJECTED";available:string} {
    const remaining=scale6ToBigInt(reservation.quantity)
      -scale6ToBigInt(reservation.consumed_quantity)
      -scale6ToBigInt(reservation.released_quantity);
    if(remaining!==scale6ToBigInt(quantity) || remaining<=0n){
      return {kind:"REJECTED",available:bigIntToScale6(this.availableUnits(scope,presentationId))};
    }
    const lots=this.reservationLotAllocations(scope,reservation.id);
    if(!this.isLotTracked(scope,presentationId)){
      if(lots.length!==0){
        return {kind:"REJECTED",available:bigIntToScale6(this.availableUnits(scope,presentationId))};
      }
      return {kind:"OK",lots:[]};
    }
    if(lots.length===0){
      return {kind:"REJECTED",available:bigIntToScale6(this.availableUnits(scope,presentationId))};
    }
    let allocated=0n;
    const today=this.now().toISOString().slice(0,10);
    for(const lot of lots){
      allocated+=lot.units;
      const row=this.database.native.prepare(`SELECT presentation_id,status,expiry_date,quantity_on_hand
        FROM inventory_lot
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`)
        .get(scope.tenantId,scope.companyId,scope.branchId,lot.id) as
          {presentation_id:string;status:string;expiry_date:string|null;quantity_on_hand:string}|undefined;
      if(!row
        ||row.presentation_id!==presentationId
        ||row.status!=="AVAILABLE"
        ||(row.expiry_date!==null && row.expiry_date<today)
        ||scale6ToBigInt(row.quantity_on_hand)<lot.units){
        return {kind:"REJECTED",available:bigIntToScale6(this.availableUnits(scope,presentationId))};
      }
    }
    if(allocated!==scale6ToBigInt(quantity)){
      return {kind:"REJECTED",available:bigIntToScale6(this.availableUnits(scope,presentationId))};
    }
    return {kind:"OK",lots};
  }

  private markReservationConsumed(input:{
    scope:SyncScope;sessionId:string;actorId:string;reservationId:string;quantity:string;
    correlationId:string;causationId:string|null;saleId:string;presentationId:string;
  }):void {
    const nowIso=this.now().toISOString();
    const updated=this.database.native.prepare(`UPDATE inventory_reservation
      SET status='CONSUMED',consumed_quantity=?,released_quantity='0.000000',
          version=version+1,updated_at=?
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?
        AND status IN ('ACTIVE','PARTIALLY_CONSUMED')`).run(
      input.quantity,nowIso,input.scope.tenantId,input.scope.companyId,input.scope.branchId,
      input.reservationId);
    if(updated.changes!==1)throw new Error("RESERVATION_CONSUME_CONFLICT");
    this.writeReservationAudit({
      scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
      reservationId:input.reservationId,actionCode:"INVENTORY_RESERVATION_CONSUMED",
      reasonCode:"SALE_COMPLETED",correlationId:input.correlationId,causationId:input.causationId,
      details:{sale_id:input.saleId,presentation_id:input.presentationId,quantity:input.quantity,
        next_status:"CONSUMED"},
      nowIso,
    });
    this.enqueueReservationOutbox({
      scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
      reservationId:input.reservationId,operationType:"INVENTORY_RESERVATION_CONSUME",
      idempotencyKey:`inventory_reservation_consume:${input.reservationId}:${input.quantity}`,
      correlationId:input.correlationId,causationId:input.causationId,
      payload:{
        reservation_id:input.reservationId,sale_id:input.saleId,
        presentation_id:input.presentationId,quantity:input.quantity,status:"CONSUMED",
      },
      nowIso,
    });
  }

  /**
   * Creates a durable reservation that reduces availability without changing
   * physical on-hand. For lot-tracked presentations, FEFO lots are allocated
   * immediately so concurrent sales cannot claim the same eligible units.
   * Does not open a transaction — callers (sale create / IPC) own the commit.
   */
  createReservation(input:{
    scope:SyncScope;sessionId:string;actorId:string;presentationId:string;
    quantity:string;referenceType:"SALE"|"MANUAL";referenceId:string;
    idempotencyKey:string;requestChecksum:string;correlationId:string;
    causationId:string|null;expiresAt:string|null;
  }):{kind:"RESERVED";reservationId:string}|{kind:"IDEMPOTENT";reservationId:string}|
    {kind:"INSUFFICIENT_STOCK";available:string}|{kind:"INVALID_QUANTITY"}|
    {kind:"IDEMPOTENCY_CONFLICT"}|{kind:"PRESENTATION_NOT_FOUND"} {
    if(!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity)||scale6ToBigInt(input.quantity)<=0n){
      return {kind:"INVALID_QUANTITY"};
    }
    const prior=this.database.native.prepare(`SELECT id,request_checksum FROM inventory_reservation
      WHERE tenant_id=? AND idempotency_key=?`)
      .get(input.scope.tenantId,input.idempotencyKey) as
        {id:string;request_checksum:string}|undefined;
    if(prior){
      return prior.request_checksum===input.requestChecksum
        ?{kind:"IDEMPOTENT",reservationId:prior.id}
        :{kind:"IDEMPOTENCY_CONFLICT"};
    }
    const presentation=this.database.native.prepare(
      `SELECT cp.id, cp.unit_precision FROM catalog_presentation cp
       JOIN catalog_product p ON p.tenant_id=cp.tenant_id AND p.id=cp.product_id
       WHERE cp.tenant_id=? AND p.company_id=? AND cp.id=?`,
    ).get(input.scope.tenantId,input.scope.companyId,input.presentationId) as
      {id:string;unit_precision:number}|undefined;
    if(!presentation)return {kind:"PRESENTATION_NOT_FOUND"};
    if(!quantityFitsUnitPrecision(input.quantity,presentation.unit_precision)){
      return {kind:"INVALID_QUANTITY"};
    }
    const available=this.availableUnits(input.scope,input.presentationId);
    const needed=scale6ToBigInt(input.quantity);
    if(available<needed)return {kind:"INSUFFICIENT_STOCK",available:bigIntToScale6(available)};

    let lots:Array<{id:string;units:bigint}>=[];
    if(this.isLotTracked(input.scope,input.presentationId)){
      const allocated=this.deductFefo({
        scope:input.scope,sessionId:input.sessionId,operatorUserId:input.actorId,
        movementId:uuidV7(),operationId:uuidV7(),presentationId:input.presentationId,
        movementType:"SALE",quantity:input.quantity,reasonCode:"RESERVATION_HOLD",
        saleId:input.referenceType==="SALE"?input.referenceId:null,
        businessDate:this.now().toISOString().slice(0,10),
        idempotencyKey:input.idempotencyKey,requestChecksum:input.requestChecksum,
        correlationId:input.correlationId,causationId:input.causationId,
      });
      if(allocated.kind==="INSUFFICIENT_STOCK"){
        return {kind:"INSUFFICIENT_STOCK",available:allocated.available};
      }
      lots=allocated.lots;
    }

    const reservationId=uuidV7();
    const nowIso=this.now().toISOString();
    this.database.native.prepare(`INSERT INTO inventory_reservation(
      id,tenant_id,company_id,branch_id,presentation_id,reference_type,reference_id,
      quantity,consumed_quantity,released_quantity,status,expires_at,origin_device_id,
      actor_id,session_id,idempotency_key,request_checksum,correlation_id,causation_id,
      version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,'0.000000','0.000000','ACTIVE',?,?,?,?,?,?,?,?,1,?,?)`).run(
      reservationId,input.scope.tenantId,input.scope.companyId,input.scope.branchId,
      input.presentationId,input.referenceType,input.referenceId,input.quantity,
      input.expiresAt,input.scope.deviceId,input.actorId,input.sessionId,
      input.idempotencyKey,input.requestChecksum,input.correlationId,input.causationId,
      nowIso,nowIso);
    for(const lot of lots){
      this.database.native.prepare(`INSERT INTO inventory_reservation_lot(
        tenant_id,company_id,branch_id,reservation_id,lot_id,quantity
      ) VALUES(?,?,?,?,?,?)`).run(
        input.scope.tenantId,input.scope.companyId,input.scope.branchId,
        reservationId,lot.id,bigIntToScale6(lot.units));
    }
    this.database.native.prepare(`INSERT INTO local_operation_audit(
      tenant_id,company_id,branch_id,device_id,actor_type,actor_id,session_id,
      action_code,resource_type,resource_id,correlation_id,causation_id,reason_code,
      details_json,created_at
    ) VALUES(?,?,?,?,'USER',?,?,'INVENTORY_RESERVATION_CREATED','INVENTORY_RESERVATION',?,?,?,?,?,?)`)
      .run(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.scope.deviceId,
        input.actorId,input.sessionId,reservationId,input.correlationId,input.causationId,
        "RESERVATION_HOLD",canonicalJson({
          presentation_id:input.presentationId,quantity:input.quantity,
          reference_type:input.referenceType,reference_id:input.referenceId,
          lot_allocations:lots.map((lot)=>({lot_id:lot.id,quantity:bigIntToScale6(lot.units)})),
        }),nowIso);
    const nextSequence=(this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,
      input.scope.deviceId,input.scope.installationId) as NextSequenceRow).next_sequence;
    this.durableSync.enqueue({
      operation_id:uuidV7(),
      tenant_id:input.scope.tenantId,company_id:input.scope.companyId,
      branch_id:input.scope.branchId,device_id:input.scope.deviceId,
      installation_id:input.scope.installationId,session_id:input.sessionId,
      actor_id:input.actorId,aggregate_type:"INVENTORY_RESERVATION",
      aggregate_id:reservationId,operation_type:"INVENTORY_RESERVATION_CREATE",
      authority_policy:"LOCAL_AUTHORITATIVE_UNTIL_SYNC",local_sequence:nextSequence,
      idempotency_key:input.idempotencyKey,expected_version:null,
      payload_schema_version:INVENTORY_PAYLOAD_SCHEMA_VERSION,
      payload:{
        reservation_id:reservationId,presentation_id:input.presentationId,
        quantity:input.quantity,reference_type:input.referenceType,
        reference_id:input.referenceId,expires_at:input.expiresAt,
        lot_allocations:lots.map((lot)=>({lot_id:lot.id,quantity:bigIntToScale6(lot.units)})),
      },
      payload_checksum:input.requestChecksum,causation_id:input.causationId,
      correlation_id:input.correlationId,occurred_at_local:nowIso,recorded_at_local:nowIso,
    });
    return {kind:"RESERVED",reservationId};
  }

  /**
   * Releases an ACTIVE MANUAL reservation without creating physical inbound stock.
   * P0: SALE-bound holds cannot be freed through the inventory IPC path while
   * (or because) a sale still owns them — only `releaseReservationsBoundToSale`
   * after an authorized Sales CANCELLED/EXPIRED transition.
   * Does not open a transaction.
   */
  releaseReservation(input:{
    scope:SyncScope;sessionId:string;actorId:string;reservationId:string;
    reasonCode:string;idempotencyKey:string;requestChecksum:string;
    correlationId:string;causationId:string|null;
  }):"RELEASED"|"IDEMPOTENT"|"CONFLICT"|"NOT_FOUND" {
    const prior=this.database.native.prepare(
      `SELECT id,status,request_checksum,quantity,reference_type,reference_id
       FROM inventory_reservation WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`)
      .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.reservationId) as
        {id:string;status:string;request_checksum:string;quantity:string;
          reference_type:string;reference_id:string}|undefined;
    if(!prior)return "NOT_FOUND";
    if(prior.reference_type==="SALE")return "CONFLICT";
    if(prior.status==="RELEASED"||prior.status==="EXPIRED"||prior.status==="CANCELLED"){
      return "IDEMPOTENT";
    }
    if(prior.status!=="ACTIVE"&&prior.status!=="PARTIALLY_CONSUMED")return "CONFLICT";
    return this.releaseReservationRow({
      scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
      reservationId:prior.id,quantity:prior.quantity,previousStatus:prior.status,
      reasonCode:input.reasonCode,idempotencyKey:input.idempotencyKey,
      correlationId:input.correlationId,causationId:input.causationId,
      details:{previous_status:prior.status,next_status:"RELEASED",
        reference_type:prior.reference_type,reference_id:prior.reference_id},
    });
  }

  /**
   * P1 Sales-bound release: free SALE holds only after the sale aggregate is
   * already CANCELLED or EXPIRED in the same local DB. Does not invent stock.
   * Does not open a transaction — Sales owns the atomic cancel/expire commit.
   */
  releaseReservationsBoundToSale(input:{
    scope:SyncScope;sessionId:string;actorId:string;saleId:string;
    reasonCode:string;correlationId:string;causationId:string|null;
  }):{kind:"RELEASED";released:number}|{kind:"CONFLICT";reason:string}|{kind:"NOT_FOUND"} {
    const sale=this.database.native.prepare(
      `SELECT id,status FROM sales_sales
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`)
      .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.saleId) as
        {id:string;status:string}|undefined;
    if(!sale)return {kind:"NOT_FOUND"};
    if(sale.status!=="CANCELLED"&&sale.status!=="EXPIRED"){
      return {kind:"CONFLICT",reason:"SALE_NOT_TERMINAL"};
    }
    const rows=this.database.native.prepare(
      `SELECT id,status,quantity FROM inventory_reservation
       WHERE tenant_id=? AND company_id=? AND branch_id=?
         AND reference_type='SALE' AND reference_id=?
         AND status IN ('ACTIVE','PARTIALLY_CONSUMED')
       ORDER BY created_at ASC,id ASC`)
      .all(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.saleId) as
        Array<{id:string;status:string;quantity:string}>;
    let released=0;
    for(const row of rows){
      const result=this.releaseReservationRow({
        scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
        reservationId:row.id,quantity:row.quantity,previousStatus:row.status,
        reasonCode:input.reasonCode,
        idempotencyKey:`inventory_reservation_release:sale:${input.saleId}:${row.id}`,
        correlationId:input.correlationId,causationId:input.causationId,
        details:{previous_status:row.status,next_status:"RELEASED",
          reference_type:"SALE",reference_id:input.saleId,sale_status:sale.status},
      });
      if(result==="RELEASED")released+=1;
      else if(result==="CONFLICT")return {kind:"CONFLICT",reason:"RESERVATION_RELEASE_CONFLICT"};
    }
    return {kind:"RELEASED",released};
  }

  private releaseReservationRow(input:{
    scope:SyncScope;sessionId:string;actorId:string;reservationId:string;quantity:string;
    previousStatus:string;reasonCode:string;idempotencyKey:string;
    correlationId:string;causationId:string|null;details:Record<string,unknown>;
  }):"RELEASED"|"IDEMPOTENT"|"CONFLICT" {
    const nowIso=this.now().toISOString();
    const updated=this.database.native.prepare(`UPDATE inventory_reservation
      SET status='RELEASED',released_quantity=?,version=version+1,updated_at=?
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=? AND version>=1
        AND status IN ('ACTIVE','PARTIALLY_CONSUMED')`).run(
      input.quantity,nowIso,input.scope.tenantId,input.scope.companyId,input.scope.branchId,
      input.reservationId);
    if(updated.changes!==1)return "CONFLICT";
    this.writeReservationAudit({
      scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
      reservationId:input.reservationId,actionCode:"INVENTORY_RESERVATION_RELEASED",
      reasonCode:input.reasonCode,correlationId:input.correlationId,causationId:input.causationId,
      details:input.details,nowIso,
    });
    this.enqueueReservationOutbox({
      scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
      reservationId:input.reservationId,operationType:"INVENTORY_RESERVATION_RELEASE",
      idempotencyKey:input.idempotencyKey,correlationId:input.correlationId,
      causationId:input.causationId,
      payload:{
        reservation_id:input.reservationId,status:"RELEASED",
        previous_status:input.previousStatus,reason_code:input.reasonCode,
      },
      nowIso,
    });
    return "RELEASED";
  }

  /**
   * Expires ACTIVE MANUAL reservations whose expires_at has passed.
   * P1: SALE holds are never clock-expired — they require a reconciled Sales
   * CANCELLED/EXPIRED transition. Does not invent stock.
   */
  expireDueReservations(scope:SyncScope,at:Date=this.now(),meta:{
    sessionId:string;actorId:string;correlationId:string;causationId:string|null;
  }|null=null):number {
    const nowIso=at.toISOString();
    const rows=this.database.native.prepare(`SELECT id,quantity FROM inventory_reservation
      WHERE tenant_id=? AND company_id=? AND branch_id=?
        AND reference_type='MANUAL'
        AND status IN ('ACTIVE','PARTIALLY_CONSUMED')
        AND expires_at IS NOT NULL AND expires_at<=?`)
      .all(scope.tenantId,scope.companyId,scope.branchId,nowIso) as Array<{id:string;quantity:string}>;
    let expired=0;
    for(const row of rows){
      const updated=this.database.native.prepare(`UPDATE inventory_reservation
        SET status='EXPIRED',released_quantity=?,version=version+1,updated_at=?
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?
          AND status IN ('ACTIVE','PARTIALLY_CONSUMED') AND reference_type='MANUAL'`).run(
        row.quantity,nowIso,scope.tenantId,scope.companyId,scope.branchId,row.id);
      if(updated.changes!==1)continue;
      expired+=1;
      if(meta!==null){
        this.writeReservationAudit({
          scope,sessionId:meta.sessionId,actorId:meta.actorId,reservationId:row.id,
          actionCode:"INVENTORY_RESERVATION_EXPIRED",reasonCode:"RESERVATION_EXPIRED",
          correlationId:meta.correlationId,causationId:meta.causationId,
          details:{previous_status:"ACTIVE",next_status:"EXPIRED",reference_type:"MANUAL"},
          nowIso,
        });
        this.enqueueReservationOutbox({
          scope,sessionId:meta.sessionId,actorId:meta.actorId,reservationId:row.id,
          operationType:"INVENTORY_RESERVATION_EXPIRE",
          idempotencyKey:`inventory_reservation_expire:${row.id}`,
          correlationId:meta.correlationId,causationId:meta.causationId,
          payload:{reservation_id:row.id,status:"EXPIRED",quantity:row.quantity},
          nowIso,
        });
      }
    }
    return expired;
  }

  private writeReservationAudit(input:{
    scope:SyncScope;sessionId:string;actorId:string;reservationId:string;
    actionCode:string;reasonCode:string;correlationId:string;causationId:string|null;
    details:Record<string,unknown>;nowIso:string;resourceType?:string;
  }):void {
    this.database.native.prepare(`INSERT INTO local_operation_audit(
      tenant_id,company_id,branch_id,device_id,actor_type,actor_id,session_id,
      action_code,resource_type,resource_id,correlation_id,causation_id,reason_code,
      details_json,created_at
    ) VALUES(?,?,?,?,'USER',?,?,?,?,?,?,?,?,?,?)`)
      .run(input.scope.tenantId,input.scope.companyId,input.scope.branchId,input.scope.deviceId,
        input.actorId,input.sessionId,input.actionCode,input.resourceType??"INVENTORY_RESERVATION",
        input.reservationId,input.correlationId,input.causationId,input.reasonCode,
        canonicalJson(input.details),input.nowIso);
  }

  private enqueueReservationOutbox(input:{
    scope:SyncScope;sessionId:string;actorId:string;reservationId:string;
    operationType:string;idempotencyKey:string;correlationId:string;causationId:string|null;
    payload:Record<string,unknown>;nowIso:string;aggregateType?:string;
  }):void {
    const nextSequence=(this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,
      input.scope.deviceId,input.scope.installationId) as NextSequenceRow).next_sequence;
    const payloadChecksum=createHash("sha256").update(canonicalJson(input.payload)).digest("hex");
    this.durableSync.enqueue({
      operation_id:uuidV7(),
      tenant_id:input.scope.tenantId,company_id:input.scope.companyId,
      branch_id:input.scope.branchId,device_id:input.scope.deviceId,
      installation_id:input.scope.installationId,session_id:input.sessionId,
      actor_id:input.actorId,aggregate_type:input.aggregateType??"INVENTORY_RESERVATION",
      aggregate_id:input.reservationId,operation_type:input.operationType,
      authority_policy:"LOCAL_AUTHORITATIVE_UNTIL_SYNC",local_sequence:nextSequence,
      idempotency_key:input.idempotencyKey,expected_version:null,
      payload_schema_version:INVENTORY_PAYLOAD_SCHEMA_VERSION,
      payload:input.payload,payload_checksum:payloadChecksum,
      causation_id:input.causationId,correlation_id:input.correlationId,
      occurred_at_local:input.nowIso,recorded_at_local:input.nowIso,
    });
  }

  /**
   * Atomic multi-output transform (despiece): consume input lots, credit output
   * lots, document shrinkage. One SQLite writer transaction — any failure rolls
   * back every movement. Mass reconciliation is required only when masses are
   * supplied; piece quantities never invent kilograms.
   */
  executeTransform(input:TransformOrderInput):TransformOrderOutcome {
    type Result=TransformOrderOutcome;
    class AbortTransform extends Error{constructor(readonly result:Result){super("TRANSFORM_ABORTED");}}
    const abort=(result:Result):never=>{throw new AbortTransform(result);};
    try{return this.database.native.transaction(():Result=>{
      const prior=this.database.native.prepare(
        `SELECT id,request_checksum FROM inventory_transform_order
         WHERE tenant_id=? AND idempotency_key=?`)
        .get(input.scope.tenantId,input.idempotencyKey) as
          {id:string;request_checksum:string}|undefined;
      if(prior){
        return prior.request_checksum===input.requestChecksum
          ?{kind:"IDEMPOTENT",orderId:prior.id}:{kind:"IDEMPOTENCY_CONFLICT"};
      }
      if(input.inputs.length===0||input.outputs.length===0)return {kind:"INVALID_QUANTITY"};
      if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.reasonCode))return {kind:"INVALID_QUANTITY"};

      let inputMass=0n,outputMass=0n,shrinkMass=0n;
      const massMode=input.canonicalMassUnit!==null;
      if(massMode){
        for(const line of input.inputs){
          if(line.massQuantity===null||!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(line.massQuantity))
            return {kind:"MASS_RECONCILIATION_FAILED"};
          inputMass+=scale6ToBigInt(line.massQuantity);
        }
        for(const line of input.outputs){
          if(line.massQuantity===null||!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(line.massQuantity))
            return {kind:"MASS_RECONCILIATION_FAILED"};
          outputMass+=scale6ToBigInt(line.massQuantity);
        }
        for(const line of input.shrinkage){
          if(line.massQuantity===null||!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(line.massQuantity))
            return {kind:"MASS_RECONCILIATION_FAILED"};
          shrinkMass+=scale6ToBigInt(line.massQuantity);
        }
        if(inputMass!==outputMass+shrinkMass)return {kind:"MASS_RECONCILIATION_FAILED"};
      }else if(
        input.inputs.some((line)=>line.massQuantity!==null)
        ||input.outputs.some((line)=>line.massQuantity!==null)
        ||input.shrinkage.some((line)=>line.massQuantity!==null)
      ){
        return {kind:"MASS_RECONCILIATION_FAILED"};
      }

      const today=this.now().toISOString().slice(0,10);
      const when=this.now().toISOString();
      const orderId=uuidV7();
      const lines:Array<{
        direction:"INPUT"|"OUTPUT"|"SHRINKAGE";presentationId:string;lotId:string;
        quantity:string;massQuantity:string|null;movementId:string;
      }>=[];

      const ensureQty=(quantity:string,presentationId:string):void=>{
        if(!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(quantity)||scale6ToBigInt(quantity)<=0n)
          abort({kind:"INVALID_QUANTITY"});
        const presentation=this.database.native.prepare(
          `SELECT unit_precision FROM catalog_presentation
           WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
        ).get(input.scope.tenantId,presentationId) as {unit_precision:number}|undefined;
        if(presentation===undefined){
          abort({kind:"PRESENTATION_NOT_FOUND"});
          return;
        }
        if(!quantityFitsUnitPrecision(quantity,presentation.unit_precision))
          abort({kind:"QUANTITY_PRECISION_EXCEEDED"});
      };

      type SellableLot={
        quantity_on_hand:string;status:string;expiry_date:string|null;batch_code:string;
        manufacture_date:string|null;supplier_reference:string;receipt_document:string;
      };
      const loadSellableLot=(presentationId:string,lotId:string):SellableLot=>{
        const record=this.database.native.prepare(`SELECT quantity_on_hand,status,expiry_date,
          batch_code,manufacture_date,supplier_reference,receipt_document
          FROM inventory_lot WHERE tenant_id=? AND company_id=? AND branch_id=?
            AND presentation_id=? AND id=?`)
          .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,presentationId,lotId) as
            SellableLot|undefined;
        if(record===undefined)abort({kind:"LOT_NOT_FOUND"});
        else if(record.status!=="AVAILABLE"||(record.expiry_date!==null&&record.expiry_date<today))
          abort({kind:"LOT_NOT_SELLABLE"});
        else return record;
        throw new Error("TRANSFORM_LOT_GUARD");
      };

      let provenance:SellableLot|null=null;

      for(const [index,line] of input.inputs.entries()){
        ensureQty(line.quantity,line.presentationId);
        const record=loadSellableLot(line.presentationId,line.lotId);
        if(provenance===null){
          provenance={
            quantity_on_hand:record.quantity_on_hand,status:record.status,
            expiry_date:record.expiry_date,batch_code:record.batch_code,
            manufacture_date:record.manufacture_date,
            supplier_reference:record.supplier_reference,receipt_document:record.receipt_document,
          };
        }
        const needed=scale6ToBigInt(line.quantity);
        const free=scale6ToBigInt(record.quantity_on_hand)-this.reservedUnitsForLot(input.scope,line.lotId);
        if(free<needed){
          if(this.reservedUnitsForLot(input.scope,line.lotId)>0n)abort({kind:"LOT_RESERVED"});
          abort({kind:"INSUFFICIENT_STOCK",available:bigIntToScale6(free>0n?free:0n)});
        }
        const movementId=uuidV7();
        const movement:AppendMovementInput={
          scope:input.scope,sessionId:input.sessionId,operatorUserId:input.actorId,
          movementId,operationId:uuidV7(),presentationId:line.presentationId,
          movementType:"TRANSFER_OUT",quantity:line.quantity,reasonCode:input.reasonCode,
          saleId:null,businessDate:input.businessDate,
          idempotencyKey:`transform:${input.idempotencyKey}:in:${index}`,
          requestChecksum:createHash("sha256").update(canonicalJson({
            transform:input.requestChecksum,leg:"INPUT",line:index,
          })).digest("hex"),
          correlationId:input.correlationId,causationId:input.causationId,
        };
        const posted=this.appendMovement(movement,true);
        if(posted.kind!=="POSTED")abort({kind:"CONFLICT"});
        this.writeLotLedger(movement,line.lotId,needed,"OUT","MATERIAL_CONSUMPTION");
        lines.push({
          direction:"INPUT",presentationId:line.presentationId,lotId:line.lotId,
          quantity:line.quantity,massQuantity:line.massQuantity,movementId,
        });
      }

      if(provenance===null){
        abort({kind:"INVALID_QUANTITY"});
        throw new Error("TRANSFORM_PROVENANCE_GUARD");
      }
      const sourceProvenance=provenance;

      for(const [index,line] of input.outputs.entries()){
        ensureQty(line.quantity,line.presentationId);
        if(line.batchCode.trim().length<1||line.batchCode.length>96)abort({kind:"INVALID_QUANTITY"});
        const destinationStock=this.getStock(input.scope,line.presentationId);
        if(!this.isLotTracked(input.scope,line.presentationId)&&
           destinationStock&&scale6ToBigInt(destinationStock.quantityOnHand)>0n){
          abort({kind:"LEGACY_STOCK_RECONCILIATION_REQUIRED"});
        }
        if(!this.isLotTracked(input.scope,line.presentationId)){
          this.database.native.prepare(`INSERT INTO inventory_lot_tracking(
            tenant_id,company_id,branch_id,presentation_id,enabled_at,actor_id)
            VALUES(?,?,?,?,?,?)`).run(input.scope.tenantId,input.scope.companyId,
            input.scope.branchId,line.presentationId,when,input.actorId);
        }
        let lot=this.database.native.prepare(`SELECT id,status,manufacture_date,expiry_date
          FROM inventory_lot WHERE tenant_id=? AND company_id=? AND branch_id=?
            AND presentation_id=? AND batch_code=?`).get(
          input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          line.presentationId,line.batchCode) as {
            id:string;status:string;manufacture_date:string|null;expiry_date:string|null;
          }|undefined;
        if(lot&&(lot.status!=="AVAILABLE"||lot.manufacture_date!==sourceProvenance.manufacture_date
          ||lot.expiry_date!==sourceProvenance.expiry_date))abort({kind:"LOT_NOT_SELLABLE"});
        const lotId=lot?.id??uuidV7();
        if(!lot){
          this.database.native.prepare(`INSERT INTO inventory_lot(
            id,tenant_id,company_id,branch_id,presentation_id,batch_code,manufacture_date,
            expiry_date,supplier_reference,receipt_document,status,quantity_on_hand,version,
            created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'AVAILABLE','0.000000',1,?,?)`).run(
            lotId,input.scope.tenantId,input.scope.companyId,input.scope.branchId,
            line.presentationId,line.batchCode,sourceProvenance.manufacture_date,sourceProvenance.expiry_date,
            sourceProvenance.supplier_reference,sourceProvenance.receipt_document,when,when);
        }
        const movementId=uuidV7();
        const units=scale6ToBigInt(line.quantity);
        const movement:AppendMovementInput={
          scope:input.scope,sessionId:input.sessionId,operatorUserId:input.actorId,
          movementId,operationId:uuidV7(),presentationId:line.presentationId,
          movementType:"TRANSFER_IN",quantity:line.quantity,reasonCode:input.reasonCode,
          saleId:null,businessDate:input.businessDate,
          idempotencyKey:`transform:${input.idempotencyKey}:out:${index}`,
          requestChecksum:createHash("sha256").update(canonicalJson({
            transform:input.requestChecksum,leg:"OUTPUT",line:index,
          })).digest("hex"),
          correlationId:input.correlationId,causationId:input.causationId,
        };
        const posted=this.appendMovement(movement,true);
        if(posted.kind!=="POSTED")abort({kind:"CONFLICT"});
        this.writeLotLedger(movement,lotId,units,"IN","CONVERSION");
        lines.push({
          direction:"OUTPUT",presentationId:line.presentationId,lotId,
          quantity:line.quantity,massQuantity:line.massQuantity,movementId,
        });
      }

      for(const [index,line] of input.shrinkage.entries()){
        ensureQty(line.quantity,line.presentationId);
        const record=loadSellableLot(line.presentationId,line.lotId);
        const needed=scale6ToBigInt(line.quantity);
        const free=scale6ToBigInt(record.quantity_on_hand)-this.reservedUnitsForLot(input.scope,line.lotId);
        if(free<needed){
          if(this.reservedUnitsForLot(input.scope,line.lotId)>0n)abort({kind:"LOT_RESERVED"});
          abort({kind:"INSUFFICIENT_STOCK",available:bigIntToScale6(free>0n?free:0n)});
        }
        const movementId=uuidV7();
        const movement:AppendMovementInput={
          scope:input.scope,sessionId:input.sessionId,operatorUserId:input.actorId,
          movementId,operationId:uuidV7(),presentationId:line.presentationId,
          movementType:"SHRINKAGE",quantity:line.quantity,reasonCode:input.reasonCode,
          saleId:null,businessDate:input.businessDate,
          idempotencyKey:`transform:${input.idempotencyKey}:shrink:${index}`,
          requestChecksum:createHash("sha256").update(canonicalJson({
            transform:input.requestChecksum,leg:"SHRINKAGE",line:index,
          })).digest("hex"),
          correlationId:input.correlationId,causationId:input.causationId,
        };
        const posted=this.appendMovement(movement,true);
        if(posted.kind!=="POSTED")abort({kind:"CONFLICT"});
        this.writeLotLedger(movement,line.lotId,needed,"OUT","SHRINKAGE");
        lines.push({
          direction:"SHRINKAGE",presentationId:line.presentationId,lotId:line.lotId,
          quantity:line.quantity,massQuantity:line.massQuantity,movementId,
        });
      }

      this.database.native.prepare(`INSERT INTO inventory_transform_order(
        tenant_id,company_id,branch_id,id,status,canonical_mass_unit,input_mass,output_mass,
        shrinkage_mass,actor_id,session_id,reason_code,idempotency_key,request_checksum,
        correlation_id,causation_id,occurred_at
      ) VALUES(?,?,?,?,'POSTED',?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.scope.tenantId,input.scope.companyId,input.scope.branchId,orderId,
        input.canonicalMassUnit,
        massMode?bigIntToScale6(inputMass):null,
        massMode?bigIntToScale6(outputMass):null,
        massMode?bigIntToScale6(shrinkMass):null,
        input.actorId,input.sessionId,input.reasonCode,input.idempotencyKey,input.requestChecksum,
        input.correlationId,input.causationId,when,
      );
      let lineNumber=1;
      for(const line of lines){
        this.database.native.prepare(`INSERT INTO inventory_transform_line(
          tenant_id,company_id,branch_id,order_id,line_number,direction,presentation_id,lot_id,
          quantity,mass_quantity,inventory_movement_id
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
          input.scope.tenantId,input.scope.companyId,input.scope.branchId,orderId,lineNumber,
          line.direction,line.presentationId,line.lotId,line.quantity,line.massQuantity,
          line.movementId,
        );
        lineNumber+=1;
      }
      this.writeReservationAudit({
        scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
        reservationId:orderId,actionCode:"INVENTORY_TRANSFORM_POSTED",
        reasonCode:input.reasonCode,correlationId:input.correlationId,causationId:input.causationId,
        resourceType:"INVENTORY_TRANSFORM",
        details:{
          order_id:orderId,input_count:input.inputs.length,output_count:input.outputs.length,
          shrinkage_count:input.shrinkage.length,canonical_mass_unit:input.canonicalMassUnit,
        },
        nowIso:when,
      });
      this.enqueueReservationOutbox({
        scope:input.scope,sessionId:input.sessionId,actorId:input.actorId,
        reservationId:orderId,operationType:"INVENTORY_TRANSFORM_POST",
        idempotencyKey:input.idempotencyKey,correlationId:input.correlationId,
        causationId:input.causationId,aggregateType:"INVENTORY_TRANSFORM",
        payload:{
          order_id:orderId,reason_code:input.reasonCode,
          canonical_mass_unit:input.canonicalMassUnit,
          lines:lines.map((line)=>({
            direction:line.direction,presentation_id:line.presentationId,lot_id:line.lotId,
            quantity:line.quantity,mass_quantity:line.massQuantity,
          })),
        },
        nowIso:when,
      });
      return {kind:"POSTED",orderId};
    })();}catch(error){
      if(error instanceof AbortTransform)return error.result;
      throw error;
    }
  }

  createReservationInTransaction(
    input:Parameters<SqliteInventoryStore["createReservation"]>[0],
  ):ReturnType<SqliteInventoryStore["createReservation"]> {
    return this.database.native.transaction(()=>this.createReservation(input))();
  }

  releaseReservationInTransaction(
    input:Parameters<SqliteInventoryStore["releaseReservation"]>[0],
  ):ReturnType<SqliteInventoryStore["releaseReservation"]> {
    return this.database.native.transaction(()=>this.releaseReservation(input))();
  }

  /** Abre la transacción que `appendMovement` no abre. Para las entradas y los ajustes. */
  appendMovementInTransaction(input: AppendMovementInput): AppendMovementOutcome {
    return this.database.native.transaction(
      (): AppendMovementOutcome => this.appendMovement(input),
    )();
  }
}