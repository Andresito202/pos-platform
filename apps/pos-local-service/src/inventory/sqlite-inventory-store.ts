import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
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
  | { readonly kind: "INSUFFICIENT_STOCK"; readonly available: string };

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
       WHERE tenant_id=? AND branch_id=? AND presentation_id=?`,
    ).get(scope.tenantId, scope.branchId, presentationId) as StockRow | undefined;

    if (row === undefined) return null;
    return {
      presentationId,
      quantityOnHand: row.quantity_on_hand,
      lastMovementSequence: row.last_movement_sequence,
    };
  }

  /**
   * Existencia disponible como entero de escala 6. Sin fila es cero.
   *
   * La venta la consulta antes de aceptar la línea: rechazar al crear es lo
   * único honesto, porque al completar el cliente ya pagó.
   */
  availableUnits(scope: InventoryScope, presentationId: string): bigint {
    const stock = this.getStock(scope, presentationId);
    return stock === null ? 0n : scale6ToBigInt(stock.quantityOnHand);
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
  appendMovement(input: AppendMovementInput): AppendMovementOutcome {
    const nowIso = this.now().toISOString();

    const operation = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as OperationRow | undefined;

    if (operation !== undefined) {
      if (operation.payload_checksum !== input.requestChecksum) {
        return { kind: "IDEMPOTENCY_CONFLICT" };
      }
      const existing = this.database.native.prepare(
        "SELECT stock_sequence, quantity_after FROM inventory_movement WHERE tenant_id=? AND idempotency_key=?",
      ).get(input.scope.tenantId, input.idempotencyKey) as MovementRow | undefined;
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
      "SELECT id FROM catalog_presentation WHERE tenant_id=? AND id=?",
    ).get(input.scope.tenantId, input.presentationId) as { id: string } | undefined;
    if (presentation === undefined) return { kind: "PRESENTATION_NOT_FOUND" };

    const current = this.database.native.prepare(
      `SELECT quantity_on_hand, last_movement_sequence, version FROM inventory_stock
       WHERE tenant_id=? AND branch_id=? AND presentation_id=?`,
    ).get(input.scope.tenantId, input.scope.branchId, input.presentationId) as StockRow | undefined;

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
         WHERE tenant_id=? AND branch_id=? AND presentation_id=? AND version=?`,
      ).run(
        quantityAfter, stockSequence, nowIso,
        input.scope.tenantId, input.scope.branchId, input.presentationId, current.version,
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
      movementId: uuidV7(),
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

  /** Abre la transacción que `appendMovement` no abre. Para las entradas y los ajustes. */
  appendMovementInTransaction(input: AppendMovementInput): AppendMovementOutcome {
    return this.database.native.transaction(
      (): AppendMovementOutcome => this.appendMovement(input),
    )();
  }
}