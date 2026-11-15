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

  /** Real sellable units, unlike consolidated physical stock containing quarantine. */
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
      const possible=scale6ToBigInt(row.quantity_on_hand);
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
  availableUnits(scope: InventoryScope, presentationId: string): bigint {
    return this.sellableUnits(scope,presentationId);
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
  appendMovement(input: AppendMovementInput, batchWrite=false): AppendMovementOutcome {
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
    const fefo=tracked&&input.movementType==="SALE"?this.deductFefo(input):null;
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

    this.enqueue(input, direction, quantityAfter, stockSequence, nowIso);

    return { kind: "POSTED", stockSequence, quantityAfter };
  }

  private enqueue(
    input: AppendMovementInput,
    direction: "IN" | "OUT",
    quantityAfter: string,
    stockSequence: number,
    nowIso: string,
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
    });

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
      const record=this.database.native.prepare(`SELECT quantity_on_hand FROM inventory_lot
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=? AND id=?`)
        .get(input.scope.tenantId,input.scope.companyId,input.scope.branchId,
          input.presentationId,lotId) as {quantity_on_hand:string}|undefined;
      if(!record)return {kind:"LOT_NOT_FOUND"} as AppendMovementOutcome;
      if(!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity)||scale6ToBigInt(input.quantity)<=0n)
        return {kind:"INVALID_QUANTITY"} as AppendMovementOutcome;
      if(scale6ToBigInt(record.quantity_on_hand)<scale6ToBigInt(input.quantity))
        return {kind:"INSUFFICIENT_STOCK",available:record.quantity_on_hand} as AppendMovementOutcome;
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

  /** Abre la transacción que `appendMovement` no abre. Para las entradas y los ajustes. */
  appendMovementInTransaction(input: AppendMovementInput): AppendMovementOutcome {
    return this.database.native.transaction(
      (): AppendMovementOutcome => this.appendMovement(input),
    )();
  }
}