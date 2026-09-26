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
  | "TRANSFER_OUT"
  | "CONVERSION_IN"
  | "CONVERSION_OUT";

/**
 * Qué tipos suman.
 *
 * El mismo emparejamiento está en un `CHECK` —de `MIGRATION_015`, reconstruido
 * por `MIGRATION_025` al entrar los tipos de conversión—: si este conjunto y el
 * `CHECK` discreparan, la escritura falla en vez de guardar una dirección
 * equivocada. La comprobación de la base es la que manda.
 */
const INBOUND_TYPES: ReadonlySet<InventoryMovementType> = new Set<InventoryMovementType>([
  "OPENING_COUNT",
  "PURCHASE_RECEIPT",
  "SALE_REVERSAL",
  "ADJUSTMENT_POSITIVE",
  "TRANSFER_IN",
  "CONVERSION_IN",
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

export interface ApplyConversionInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  /** Escala 6, ya comprobada por el caso de uso. */
  readonly sourceQuantity: string;
  readonly targetQuantity: string;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ApplyConversionOutcome =
  | {
      readonly kind: "CONVERTED" | "IDEMPOTENT";
      readonly sourceQuantityAfter: string;
      readonly targetQuantityAfter: string;
    }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PRESENTATION_NOT_FOUND" }
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

export interface ReceiveLotInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly presentationId: string;
  readonly lotCode: string;
  readonly quantity: string;
  readonly manufacturedDate: string | null;
  readonly expiryDate: string | null;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ReceiveLotOutcome =
  | { readonly kind: "RECEIVED"; readonly lotId: string; readonly quantityAfter: string; readonly lotQuantityOnHand: string }
  | { readonly kind: "LOT_CODE_CONFLICT" }
  | { readonly kind: "LOT_DATES_INVALID" }
  | AppendMovementOutcome;

export type LotRejectionOutcome =
  | { readonly kind: "LOT_NOT_FOUND" }
  | { readonly kind: "LOT_INSUFFICIENT"; readonly available: string };

export type AdjustWithLotsOutcome = AppendMovementOutcome | LotRejectionOutcome;

/**
 * Sale de una transacción para deshacerla y lleva el desenlace que se
 * devuelve. Nunca escapa del método que la lanza.
 *
 * Existe porque **devolver** un rechazo desde dentro de la transacción la
 * confirma: lo ya escrito —el movimiento— se queda. Rechazar tiene que ser
 * lanzar.
 */
class Rollback<T extends { readonly kind: string }> extends Error {
  constructor(readonly outcome: T) {
    super(outcome.kind);
  }
}

export interface LotRow {
  readonly lotId: string;
  readonly lotCode: string;
  readonly receivedDate: string;
  readonly expiryDate: string | null;
  readonly quantityOnHand: string;
  readonly status: "ACTIVE" | "BLOCKED" | "CONSUMED";
}

export interface LotTrace {
  readonly lot: {
    readonly lotId: string;
    readonly lotCode: string;
    readonly receivedDate: string;
    readonly manufacturedDate: string | null;
    readonly expiryDate: string | null;
    readonly quantityOnHand: string;
    readonly status: "ACTIVE" | "BLOCKED" | "CONSUMED";
  };
  readonly quantityReceived: string;
  /** El lote de la paca de la que salió este, si salió de una. */
  readonly originLot: { readonly presentationId: string; readonly lotCode: string } | null;
  /** Los lotes de unidades que salieron de abrir este. */
  readonly derivedLots: readonly {
    readonly presentationId: string;
    readonly lotCode: string;
    readonly quantityOnHand: string;
    readonly status: "ACTIVE" | "BLOCKED" | "CONSUMED";
  }[];
  /** Lo que entró al lote, en orden: recepción, remesa, herencia de paca, ajuste positivo. */
  readonly inflows: readonly {
    readonly movementType: "PURCHASE_RECEIPT" | "CONVERSION_IN" | "ADJUSTMENT_POSITIVE";
    readonly quantity: string;
    readonly reasonCode: string;
    readonly businessDate: string;
    readonly occurredAt: string;
  }[];
  readonly outflows: readonly {
    readonly movementType: "SALE" | "SHRINKAGE" | "ADJUSTMENT_NEGATIVE" | "TRANSFER_OUT" | "CONVERSION_OUT";
    readonly quantity: string;
    readonly saleId: string | null;
    readonly reasonCode: string;
    readonly businessDate: string;
    readonly occurredAt: string;
  }[];
  readonly truncated: boolean;
}

export interface ExpiringLotRow {
  readonly presentationId: string;
  readonly lotCode: string;
  readonly expiryDate: string;
  readonly quantityOnHand: string;
  readonly status: "ACTIVE" | "BLOCKED";
}

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

    const movementId = uuidV7();
    const outcome = this.appendMovement({
      scope: input.scope,
      sessionId: input.sessionId,
      operatorUserId: input.operatorUserId,
      movementId,
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
        // Sólo aquí. Un `IDEMPOTENT` es la misma finalización reintentada:
        // asignar otra vez descontaría dos veces del lote lo que el saldo
        // descontó una.
        this.allocateFefo(
          input.scope, input.presentationId, input.businessDate, input.quantity,
          movementId, input.saleId,
        );
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
   * Conversión atómica (`DEC-004` §1736): salida en origen y entrada en destino
   * **confirmadas juntas**.
   *
   * La invariante que el ADR exige —«no puede quedar salida confirmada sin
   * entrada ni entrada sin salida»— la da la transacción, no una comprobación
   * posterior: si la entrada falla, la salida se deshace con ella.
   *
   * Las dos mitades llevan claves de idempotencia derivadas de la del
   * llamador. Son movimientos distintos y el índice único de
   * `inventory_movement` exige una clave por fila; derivarlas mantiene la
   * repetición segura sin pedirle al llamador dos claves para una sola
   * decisión suya.
   *
   * El factor **no se recalcula aquí**: llega ya resuelto y comprobado por el
   * caso de uso, que es quien posee la conversión. Este almacén escribe
   * movimientos; no interpreta el catálogo.
   */
  applyConversion(input: ApplyConversionInput): ApplyConversionOutcome {
    return this.database.native.transaction((): ApplyConversionOutcome => {
      const outMovementId = uuidV7();
      const out = this.appendMovement({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        movementId: outMovementId,
        operationId: uuidV7(),
        presentationId: input.sourcePresentationId,
        movementType: "CONVERSION_OUT",
        quantity: input.sourceQuantity,
        reasonCode: input.reasonCode,
        saleId: null,
        businessDate: input.businessDate,
        idempotencyKey: `${input.idempotencyKey}:out`,
        requestChecksum: input.requestChecksum,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
      if (out.kind !== "POSTED" && out.kind !== "IDEMPOTENT") return out;
      // Abrir una paca es una salida de la paca: sale de sus lotes por FEFO,
      // igual que una venta. Sólo al publicarse, nunca al repetirse.
      const pieces = out.kind === "POSTED"
        ? this.allocateFefo(
          input.scope, input.sourcePresentationId, input.businessDate, input.sourceQuantity,
          outMovementId, null,
        )
        : [];

      const inMovementId = uuidV7();
      const entry = this.appendMovement({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        movementId: inMovementId,
        operationId: uuidV7(),
        presentationId: input.targetPresentationId,
        movementType: "CONVERSION_IN",
        quantity: input.targetQuantity,
        reasonCode: input.reasonCode,
        saleId: null,
        businessDate: input.businessDate,
        idempotencyKey: `${input.idempotencyKey}:in`,
        requestChecksum: input.requestChecksum,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
      if (entry.kind !== "POSTED" && entry.kind !== "IDEMPOTENT") return entry;
      if (entry.kind === "POSTED") {
        this.inheritLots(
          input.scope, pieces, input.targetPresentationId, input.sourceQuantity, input.targetQuantity,
          inMovementId,
        );
      }

      // Repetir la conversión entera devuelve `IDEMPOTENT`; que una mitad ya
      // estuviera y la otra no es un estado que la transacción impide.
      const repeated = out.kind === "IDEMPOTENT" && entry.kind === "IDEMPOTENT";
      return {
        kind: repeated ? "IDEMPOTENT" : "CONVERTED",
        sourceQuantityAfter: out.quantityAfter,
        targetQuantityAfter: entry.quantityAfter,
      };
    })();
  }

  /**
   * Qué lotes se llevó una salida — venta, ajuste sin lote o apertura de
   * presentación — FEFO sobre lotes **vigentes**.
   *
   * ## La regla no se decide aquí: se aplica
   *
   * `UC-INVENTORY-002` §Vencimientos, regla 1: «FEFO prioriza el lote con
   * vencimiento **válido** más próximo». La selección automática nunca toma
   * un lote vencido; lo vencido sale por merma o ajuste explícito (regla 5).
   * Vence **al final** del día declarado, como en `lotExpiryState`: un lote
   * que vence hoy todavía se vende hoy. Los lotes sin vencimiento van
   * después de todos los que vencen, porque no compiten por salir primero.
   *
   * ## Lo que no cubre ningún lote no se inventa
   *
   * Si la presentación no tiene lotes, no hay nada que asignar y la venta
   * sigue exactamente como antes: esta capacidad no cambia a quien no la usa.
   *
   * Si tiene lotes pero los vigentes no alcanzan —existencia que entró sin
   * lote, o que sólo queda en tandas vencidas—, se asigna lo que alcanzan y
   * **el resto queda sin asignar**. No se reparte en un lote cualquiera: eso
   * fabricaría un rastro falso, que es peor que ninguno en un retiro
   * sanitario. La diferencia no se esconde: es medible como la cantidad del
   * movimiento menos la suma de sus asignaciones.
   *
   * **La venta no se bloquea por esto.** Se ejecuta al cobrar, con el dinero
   * ya recibido; decidir que una tienda no puede vender sin lote es política
   * y no está decidida.
   */
  private allocateFefo(
    scope: SyncScope, presentationId: string, businessDate: string, quantity: string,
    movementId: string, saleId: string | null,
  ): readonly { readonly lotId: string; readonly taken: bigint }[] {
    const lots = this.database.native.prepare(
      `SELECT id, quantity_on_hand FROM inventory_lot
        WHERE tenant_id=? AND branch_id=? AND presentation_id=?
          AND status='ACTIVE' AND quantity_on_hand <> '0.000000'
          AND (expiry_date IS NULL OR expiry_date >= ?)
        ORDER BY expiry_date IS NULL, expiry_date, received_date, lot_code`,
    ).all(
      scope.tenantId, scope.branchId, presentationId, businessDate,
    ) as { id: string; quantity_on_hand: string }[];

    const pieces: { lotId: string; taken: bigint }[] = [];
    let remaining = scale6ToBigInt(quantity);
    for (const lot of lots) {
      if (remaining === 0n) break;
      const available = scale6ToBigInt(lot.quantity_on_hand);
      const taken = available < remaining ? available : remaining;
      this.takeFromLot(scope.tenantId, lot.id, available, taken, movementId, saleId);
      pieces.push({ lotId: lot.id, taken });
      remaining -= taken;
    }
    return pieces;
  }

  /**
   * Las unidades de una paca abierta heredan el lote de la paca.
   *
   * Por cada lote del que salió la paca, las unidades entran en un lote de la
   * presentación destino con **el mismo código y las mismas fechas**, y
   * `origin_lot_id` apuntando al de la paca (`MIGRATION_029`). La cuota de
   * cada lote es `tomado × destino / origen`: la misma proporción que la
   * conversión entera, sin volver a leer el factor del catálogo.
   *
   * **Lo que no se puede heredar con verdad entra sin lote**, igual que la
   * existencia que nunca lo tuvo:
   *
   * - si la cuota de un lote no da exacta en escala 6 —el total sí lo da, lo
   *   comprueba el caso de uso, pero un reparto entre dos tandas puede no—;
   * - si en la presentación destino ya existe ese código **con otro origen**:
   *   fusionar dos tandas bajo un mismo código es justo lo que haría ambiguo
   *   un retiro, y el índice único impide crear una segunda.
   *
   * Lo que entra sin lote es medible: existencia de la presentación menos la
   * suma de sus lotes.
   */
  private inheritLots(
    scope: SyncScope,
    pieces: readonly { readonly lotId: string; readonly taken: bigint }[],
    targetPresentationId: string,
    sourceQuantity: string,
    targetQuantity: string,
    inMovementId: string,
  ): void {
    const source6 = scale6ToBigInt(sourceQuantity);
    const target6 = scale6ToBigInt(targetQuantity);
    const at = this.now().toISOString();

    for (const piece of pieces) {
      const numerator = piece.taken * target6;
      if (numerator % source6 !== 0n) continue;
      const share = numerator / source6;
      if (share === 0n) continue;

      const origin = this.database.native.prepare(
        `SELECT lot_code, received_date, manufactured_date, expiry_date
           FROM inventory_lot WHERE tenant_id=? AND id=?`,
      ).get(scope.tenantId, piece.lotId) as {
        lot_code: string; received_date: string;
        manufactured_date: string | null; expiry_date: string | null;
      };

      const existing = this.database.native.prepare(
        `SELECT id, quantity_on_hand, origin_lot_id FROM inventory_lot
          WHERE tenant_id=? AND branch_id=? AND presentation_id=? AND lot_code=?`,
      ).get(scope.tenantId, scope.branchId, targetPresentationId, origin.lot_code) as {
        id: string; quantity_on_hand: string; origin_lot_id: string | null;
      } | undefined;

      // La misma regla que al recibir: si otra sucursal tiene ese código con
      // otras fechas, las unidades no heredan —entran sin lote— en vez de
      // fabricar una segunda versión de la tanda.
      if (this.datesConflictInOtherBranch(
        scope, targetPresentationId, origin.lot_code, origin.manufactured_date, origin.expiry_date,
      )) continue;

      if (existing === undefined) {
        const inheritedId = uuidV7();
        this.database.native.prepare(
          `INSERT INTO inventory_lot(
            id, tenant_id, company_id, branch_id, presentation_id, lot_code,
            received_date, manufactured_date, expiry_date,
            quantity_on_hand, quantity_reserved, status, origin_lot_id, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,'0.000000','ACTIVE',?,?,?)`,
        ).run(
          inheritedId, scope.tenantId, scope.companyId, scope.branchId, targetPresentationId,
          origin.lot_code, origin.received_date, origin.manufactured_date, origin.expiry_date,
          bigIntToScale6(share), piece.lotId, at, at,
        );
        this.recordLotEntry(scope.tenantId, inheritedId, inMovementId, share);
        continue;
      }
      if (existing.origin_lot_id !== piece.lotId) continue;

      // Otra paca de la misma tanda: suma al lote de unidades que ya salió de
      // ella, y lo reactiva si se había agotado.
      this.database.native.prepare(
        `UPDATE inventory_lot SET quantity_on_hand=?, status='ACTIVE', updated_at=?
          WHERE tenant_id=? AND id=?`,
      ).run(
        bigIntToScale6(scale6ToBigInt(existing.quantity_on_hand) + share), at,
        scope.tenantId, existing.id,
      );
      this.recordLotEntry(scope.tenantId, existing.id, inMovementId, share);
    }
  }

  /**
   * ¿Hay en **otra** sucursal un lote de esta presentación con este código y
   * otras fechas? — decisión del propietario del 2026-09-26: la misma tanda
   * del proveedor en dos sucursales es la misma tanda, y trae las mismas
   * fechas. Si no coinciden es un error de captura en una de las dos, y un
   * retiro sanitario por código no sabría qué vencimiento creer.
   *
   * Sólo se comparan fabricación y vencimiento, igual que dentro de una
   * sucursal: la fecha de recepción es de cada sucursal y puede diferir.
   * `IS NOT` compara `NULL` como valor: una sucursal sin vencimiento y otra
   * con él también discrepan.
   */
  private datesConflictInOtherBranch(
    scope: SyncScope, presentationId: string, lotCode: string,
    manufacturedDate: string | null, expiryDate: string | null,
  ): boolean {
    return this.database.native.prepare(
      `SELECT 1 FROM inventory_lot
        WHERE tenant_id=? AND presentation_id=? AND lot_code=? AND branch_id <> ?
          AND (manufactured_date IS NOT ? OR expiry_date IS NOT ?)
        LIMIT 1`,
    ).get(
      scope.tenantId, presentationId, lotCode, scope.branchId, manufacturedDate, expiryDate,
    ) !== undefined;
  }

  /**
   * Deja en el libro del lote una **entrada** (`MIGRATION_030`): la recepción,
   * la remesa, la herencia de una paca o el ajuste positivo. Quien actualiza
   * `quantity_on_hand` hacia arriba llama a esto en la misma transacción; así
   * la cantidad del lote es siempre entradas menos salidas, y un lote no puede
   * crecer sin decir por qué.
   */
  private recordLotEntry(tenantId: string, lotId: string, movementId: string, quantity: bigint): void {
    this.database.native.prepare(
      `INSERT INTO inventory_lot_allocation(
        id, tenant_id, lot_id, movement_id, sale_id, quantity, direction, created_at
      ) VALUES (?,?,?,?,NULL,?,'IN',?)`,
    ).run(uuidV7(), tenantId, lotId, movementId, bigIntToScale6(quantity), this.now().toISOString());
  }

  /**
   * Descuenta `taken` de un lote y deja su asignación. Un lote agotado pasa a
   * `CONSUMED`: no desaparece, porque su rastro es justo lo que un retiro
   * necesita consultar después.
   */
  private takeFromLot(
    tenantId: string, lotId: string, available: bigint, taken: bigint,
    movementId: string, saleId: string | null,
  ): void {
    const at = this.now().toISOString();
    const left = available - taken;
    this.database.native.prepare(
      `INSERT INTO inventory_lot_allocation(
        id, tenant_id, lot_id, movement_id, sale_id, quantity, direction, created_at
      ) VALUES (?,?,?,?,?,?,'OUT',?)`,
    ).run(uuidV7(), tenantId, lotId, movementId, saleId, bigIntToScale6(taken), at);
    this.database.native.prepare(
      `UPDATE inventory_lot SET quantity_on_hand=?, status=?, updated_at=?
        WHERE tenant_id=? AND id=?`,
    ).run(bigIntToScale6(left), left === 0n ? "CONSUMED" : "ACTIVE", at, tenantId, lotId);
  }

  /**
   * Recepción con lote — `UC-INVENTORY-002` §Lotes.
   *
   * **El lote y el movimiento se escriben juntos o no se escribe ninguno.** Un
   * lote sin su entrada de inventario sería existencia que el saldo no conoce;
   * una entrada sin lote sería existencia sin rastro. Las dos mitades por
   * separado son peores que ninguna, así que comparten transacción — el mismo
   * criterio que la conversión atómica.
   *
   * Recibir dos veces el **mismo** código de lote suma a ese lote: es la
   * segunda remesa de la misma tanda. Recibirlo con **otras fechas** es
   * `LOT_CODE_CONFLICT` y no se fusiona: dos tandas distintas bajo un mismo
   * código harían ambiguo un retiro sanitario, y elegir en silencio cuál de
   * las dos fechas vale sería inventar el dato que más importa.
   */
  receiveLot(input: ReceiveLotInput): ReceiveLotOutcome {
    try {
      return this.receiveLotInTransaction(input);
    } catch (thrown) {
      if (thrown instanceof Rollback) return thrown.outcome as ReceiveLotOutcome;
      throw thrown;
    }
  }

  private receiveLotInTransaction(input: ReceiveLotInput): ReceiveLotOutcome {
    return this.database.native.transaction((): ReceiveLotOutcome => {
      const existing = this.database.native.prepare(
        `SELECT id, manufactured_date, expiry_date, quantity_on_hand, status
           FROM inventory_lot
          WHERE tenant_id=? AND branch_id=? AND presentation_id=? AND lot_code=?`,
      ).get(input.scope.tenantId, input.scope.branchId, input.presentationId, input.lotCode) as {
        id: string; manufactured_date: string | null; expiry_date: string | null;
        quantity_on_hand: string; status: string;
      } | undefined;

      if (existing !== undefined
        && (existing.expiry_date !== input.expiryDate
          || existing.manufactured_date !== input.manufacturedDate)) {
        return { kind: "LOT_CODE_CONFLICT" };
      }
      if (this.datesConflictInOtherBranch(
        input.scope, input.presentationId, input.lotCode, input.manufacturedDate, input.expiryDate,
      )) {
        return { kind: "LOT_CODE_CONFLICT" };
      }

      const receiptMovementId = uuidV7();
      const movement = this.appendMovement({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        movementId: receiptMovementId,
        operationId: uuidV7(),
        presentationId: input.presentationId,
        movementType: "PURCHASE_RECEIPT",
        quantity: input.quantity,
        reasonCode: input.reasonCode,
        saleId: null,
        businessDate: input.businessDate,
        idempotencyKey: input.idempotencyKey,
        requestChecksum: input.requestChecksum,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
      if (movement.kind !== "POSTED") return movement;

      const at = this.now().toISOString();
      const lotId = existing?.id ?? uuidV7();
      const lotQuantity = existing === undefined
        ? input.quantity
        : bigIntToScale6(
          scale6ToBigInt(existing.quantity_on_hand) + scale6ToBigInt(input.quantity),
        );

      if (existing === undefined) {
        try {
          this.database.native.prepare(
            `INSERT INTO inventory_lot(
              id, tenant_id, company_id, branch_id, presentation_id, lot_code,
              received_date, manufactured_date, expiry_date,
              quantity_on_hand, quantity_reserved, status, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,'0.000000','ACTIVE',?,?)`,
          ).run(
            lotId, input.scope.tenantId, input.scope.companyId, input.scope.branchId,
            input.presentationId, input.lotCode, input.businessDate,
            input.manufacturedDate, input.expiryDate, lotQuantity, at, at,
          );
        } catch (error) {
          // Las fechas incoherentes las rechaza el `CHECK` del esquema, no una
          // comprobación de la aplicación: así la regla vale también para un
          // escritor futuro que no pase por aquí.
          //
          // Se LANZA, no se devuelve: el movimiento de entrada ya está escrito
          // y devolver confirmaría la transacción con él dentro —existencia
          // que sube sin lote—. Medido el 2026-09-26: subía.
          if (String(error).includes("CHECK")) {
            throw new Rollback<ReceiveLotOutcome>({ kind: "LOT_DATES_INVALID" });
          }
          throw error;
        }
      } else {
        // Una remesa sobre una tanda agotada la reactiva: con existencia y en
        // `CONSUMED`, FEFO —que sólo toma `ACTIVE`— nunca la vendería.
        this.database.native.prepare(
          "UPDATE inventory_lot SET quantity_on_hand=?, status='ACTIVE', updated_at=? WHERE tenant_id=? AND id=?",
        ).run(lotQuantity, at, input.scope.tenantId, lotId);
      }
      this.recordLotEntry(input.scope.tenantId, lotId, receiptMovementId, scale6ToBigInt(input.quantity));

      return {
        kind: "RECEIVED",
        lotId,
        quantityAfter: movement.quantityAfter,
        lotQuantityOnHand: lotQuantity,
      };
    })();
  }

  /**
   * Lotes de una presentación, **en orden FEFO**: primero lo que vence antes.
   *
   * Los lotes sin vencimiento van al final porque no compiten por salir
   * primero. El orden lo decide el almacén y no la pantalla: si cada llamador
   * ordenara a su gusto, dos pantallas mostrarían dos «siguiente lote»
   * distintos y el cajero no sabría cuál creer.
   */
  listLots(tenantId: string, branchId: string, presentationId: string): readonly LotRow[] {
    const rows = this.database.native.prepare(
      `SELECT id, lot_code, received_date, expiry_date, quantity_on_hand, status
         FROM inventory_lot
        WHERE tenant_id=? AND branch_id=? AND presentation_id=?
        ORDER BY expiry_date IS NULL, expiry_date, received_date, lot_code`,
    ).all(tenantId, branchId, presentationId) as {
      id: string; lot_code: string; received_date: string;
      expiry_date: string | null; quantity_on_hand: string; status: string;
    }[];
    return rows.map((row) => ({
      lotId: row.id,
      lotCode: row.lot_code,
      receivedDate: row.received_date,
      expiryDate: row.expiry_date,
      quantityOnHand: row.quantity_on_hand,
      status: row.status as LotRow["status"],
    }));
  }

  /**
   * Ajuste de existencia **con sus lotes** — `UC-INVENTORY-002` §Salidas,
   * §Mermas y §Lote vencido.
   *
   * Una salida que baja el saldo sin bajar el lote deja al lote diciendo que
   * tiene lo que ya no hay, y la siguiente venta lo tomaría por FEFO. Por eso
   * toda salida resuelve su lote en la misma transacción que su movimiento:
   *
   * - **Con `lotCode`** es la «selección autorizada» (§Salidas, paso 4): la
   *   cantidad entera sale de ese lote, **esté o no vencido**. Es la única vía
   *   por la que sale un lote vencido (§Lote vencido, regla 2). Si el lote no
   *   existe en esta sucursal o no alcanza, **no se escribe nada**: repartir
   *   el resto en otro lote sería decidir por el operador qué tanda perdió.
   * - **Sin `lotCode`**, FEFO sobre vigentes, como la venta. Lo que no cubran
   *   queda sin asignar: no se inventa de qué tanda salió.
   *
   * La idempotencia va primero: una repetición devuelve `IDEMPOTENT` antes de
   * mirar el lote, que para entonces ya tiene descontado lo suyo.
   */
  adjustWithLots(input: AppendMovementInput, lotCode: string | null): AdjustWithLotsOutcome {
    const outflow = input.movementType !== "ADJUSTMENT_POSITIVE";
    try {
      return this.database.native.transaction((): AdjustWithLotsOutcome => {
        const outcome = this.appendMovement(input);
        if (outcome.kind !== "POSTED") return outcome;
        if (!outflow) {
          if (lotCode !== null) this.addToNamedLot(input, lotCode);
          return outcome;
        }

        if (lotCode === null) {
          this.allocateFefo(
            input.scope, input.presentationId, input.businessDate, input.quantity,
            input.movementId, null,
          );
          return outcome;
        }

        const lot = this.database.native.prepare(
          `SELECT id, quantity_on_hand FROM inventory_lot
            WHERE tenant_id=? AND branch_id=? AND presentation_id=? AND lot_code=?`,
        ).get(
          input.scope.tenantId, input.scope.branchId, input.presentationId, lotCode,
        ) as { id: string; quantity_on_hand: string } | undefined;
        if (lot === undefined) throw new Rollback<LotRejectionOutcome>({ kind: "LOT_NOT_FOUND" });

        const available = scale6ToBigInt(lot.quantity_on_hand);
        const wanted = scale6ToBigInt(input.quantity);
        if (available < wanted) {
          throw new Rollback<LotRejectionOutcome>({ kind: "LOT_INSUFFICIENT", available: lot.quantity_on_hand });
        }
        this.takeFromLot(input.scope.tenantId, lot.id, available, wanted, input.movementId, null);
        return outcome;
      })();
    } catch (thrown) {
      // Lanzar deshace el movimiento ya escrito: rechazar por el lote no
      // puede dejar el saldo descontado.
      if (thrown instanceof Rollback) return thrown.outcome as LotRejectionOutcome;
      throw thrown;
    }
  }

  /**
   * Rastro de un lote en la sucursal del contexto: el lote y cada salida que
   * se lo llevó, en orden de ocurrencia.
   *
   * Sólo lee tablas de este módulo —`inventory_lot`, `inventory_lot_allocation`
   * e `inventory_movement`—: el comprador de una venta no es dato de
   * inventario. `quantityReceived` se calcula sobre **todas** las
   * asignaciones, no sólo las devueltas, para que un rastro truncado no
   * cuadre mal además de venir cortado.
   */
  traceLot(
    tenantId: string, branchId: string, presentationId: string, lotCode: string, limit: number,
  ): LotTrace | null {
    const lot = this.database.native.prepare(
      `SELECT id, lot_code, received_date, manufactured_date, expiry_date, quantity_on_hand, status,
              origin_lot_id
         FROM inventory_lot
        WHERE tenant_id=? AND branch_id=? AND presentation_id=? AND lot_code=?`,
    ).get(tenantId, branchId, presentationId, lotCode) as {
      id: string; lot_code: string; received_date: string; manufactured_date: string | null;
      expiry_date: string | null; quantity_on_hand: string; status: string;
      origin_lot_id: string | null;
    } | undefined;
    if (lot === undefined) return null;

    const origin = lot.origin_lot_id === null ? undefined : this.database.native.prepare(
      "SELECT presentation_id, lot_code FROM inventory_lot WHERE tenant_id=? AND id=?",
    ).get(tenantId, lot.origin_lot_id) as { presentation_id: string; lot_code: string } | undefined;
    const derived = this.database.native.prepare(
      `SELECT presentation_id, lot_code, quantity_on_hand, status FROM inventory_lot
        WHERE tenant_id=? AND origin_lot_id=? ORDER BY presentation_id, lot_code`,
    ).all(tenantId, lot.id) as {
      presentation_id: string; lot_code: string; quantity_on_hand: string; status: string;
    }[];

    const all = this.database.native.prepare(
      "SELECT quantity FROM inventory_lot_allocation WHERE tenant_id=? AND lot_id=? AND direction='OUT'",
    ).all(tenantId, lot.id) as { quantity: string }[];
    const taken = all.reduce((sum, row) => sum + scale6ToBigInt(row.quantity), 0n);

    // Uno más del tope: si llega, hay más de las que caben y se dice.
    const rows = this.database.native.prepare(
      `SELECT m.movement_type, a.quantity, a.sale_id, m.reason_code, m.business_date, m.occurred_at
         FROM inventory_lot_allocation a
         JOIN inventory_movement m ON m.tenant_id=a.tenant_id AND m.id=a.movement_id
        WHERE a.tenant_id=? AND a.lot_id=? AND a.direction='OUT'
        ORDER BY m.occurred_at, m.stock_sequence, a.id
        LIMIT ?`,
    ).all(tenantId, lot.id, limit + 1) as {
      movement_type: LotTrace["outflows"][number]["movementType"]; quantity: string;
      sale_id: string | null; reason_code: string; business_date: string; occurred_at: string;
    }[];

    const entries = this.database.native.prepare(
      `SELECT m.movement_type, a.quantity, m.reason_code, m.business_date, m.occurred_at
         FROM inventory_lot_allocation a
         JOIN inventory_movement m ON m.tenant_id=a.tenant_id AND m.id=a.movement_id
        WHERE a.tenant_id=? AND a.lot_id=? AND a.direction='IN'
        ORDER BY m.occurred_at, m.stock_sequence, a.id
        LIMIT ?`,
    ).all(tenantId, lot.id, limit + 1) as {
      movement_type: LotTrace["inflows"][number]["movementType"]; quantity: string;
      reason_code: string; business_date: string; occurred_at: string;
    }[];

    return {
      lot: {
        lotId: lot.id,
        lotCode: lot.lot_code,
        receivedDate: lot.received_date,
        manufacturedDate: lot.manufactured_date,
        expiryDate: lot.expiry_date,
        quantityOnHand: lot.quantity_on_hand,
        status: lot.status as LotTrace["lot"]["status"],
      },
      quantityReceived: bigIntToScale6(scale6ToBigInt(lot.quantity_on_hand) + taken),
      originLot: origin === undefined
        ? null
        : { presentationId: origin.presentation_id, lotCode: origin.lot_code },
      derivedLots: derived.map((row) => ({
        presentationId: row.presentation_id,
        lotCode: row.lot_code,
        quantityOnHand: row.quantity_on_hand,
        status: row.status as LotTrace["lot"]["status"],
      })),
      outflows: rows.slice(0, limit).map((row) => ({
        movementType: row.movement_type,
        quantity: row.quantity,
        saleId: row.sale_id,
        reasonCode: row.reason_code,
        businessDate: row.business_date,
        occurredAt: row.occurred_at,
      })),
      inflows: entries.slice(0, limit).map((row) => ({
        movementType: row.movement_type,
        quantity: row.quantity,
        reasonCode: row.reason_code,
        businessDate: row.business_date,
        occurredAt: row.occurred_at,
      })),
      truncated: rows.length > limit || entries.length > limit,
    };
  }

  /**
   * Ajuste positivo **a una tanda que ya existe**: se encontró más de lo que
   * el lote decía. Suma, reactiva si estaba agotada y deja la entrada en el
   * libro con el movimiento del ajuste —tipo, motivo y actor—.
   *
   * No crea lotes: una tanda nueva trae fechas, y se declara recibiéndola.
   * Un código que no existe en esta sucursal es `LOT_NOT_FOUND` y el
   * movimiento se deshace. Un lote vencido sí admite la corrección: aparecer
   * más producto vencido es un hallazgo que después sale por merma.
   */
  private addToNamedLot(input: AppendMovementInput, lotCode: string): void {
    const lot = this.database.native.prepare(
      `SELECT id, quantity_on_hand FROM inventory_lot
        WHERE tenant_id=? AND branch_id=? AND presentation_id=? AND lot_code=?`,
    ).get(
      input.scope.tenantId, input.scope.branchId, input.presentationId, lotCode,
    ) as { id: string; quantity_on_hand: string } | undefined;
    if (lot === undefined) throw new Rollback<LotRejectionOutcome>({ kind: "LOT_NOT_FOUND" });

    const added = scale6ToBigInt(input.quantity);
    this.database.native.prepare(
      `UPDATE inventory_lot SET quantity_on_hand=?, status='ACTIVE', updated_at=?
        WHERE tenant_id=? AND id=?`,
    ).run(
      bigIntToScale6(scale6ToBigInt(lot.quantity_on_hand) + added), this.now().toISOString(),
      input.scope.tenantId, lot.id,
    );
    this.recordLotEntry(input.scope.tenantId, lot.id, input.movementId, added);
  }

  /**
   * Tandas **con existencia** de la sucursal que vencen hasta `horizon`
   * inclusive —lo vencido incluido—, por vencimiento. Una agotada no aparece:
   * no hay nada que vender ni que botar.
   */
  listExpiringLots(
    tenantId: string, branchId: string, horizon: string, limit: number,
  ): { readonly lots: readonly ExpiringLotRow[]; readonly truncated: boolean } {
    const rows = this.database.native.prepare(
      `SELECT presentation_id, lot_code, expiry_date, quantity_on_hand, status
         FROM inventory_lot
        WHERE tenant_id=? AND branch_id=?
          AND status <> 'CONSUMED' AND quantity_on_hand <> '0.000000'
          AND expiry_date IS NOT NULL AND expiry_date <= ?
        ORDER BY expiry_date, presentation_id, lot_code
        LIMIT ?`,
    ).all(tenantId, branchId, horizon, limit + 1) as {
      presentation_id: string; lot_code: string; expiry_date: string;
      quantity_on_hand: string; status: "ACTIVE" | "BLOCKED";
    }[];
    return {
      lots: rows.slice(0, limit).map((row) => ({
        presentationId: row.presentation_id,
        lotCode: row.lot_code,
        expiryDate: row.expiry_date,
        quantityOnHand: row.quantity_on_hand,
        status: row.status,
      })),
      truncated: rows.length > limit,
    };
  }

  /** Abre la transacción que `appendMovement` no abre. Para las entradas y los ajustes. */
  appendMovementInTransaction(input: AppendMovementInput): AppendMovementOutcome {
    return this.database.native.transaction(
      (): AppendMovementOutcome => this.appendMovement(input),
    )();
  }
}