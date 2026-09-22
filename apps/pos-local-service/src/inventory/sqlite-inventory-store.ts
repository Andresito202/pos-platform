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

export interface LotRow {
  readonly lotId: string;
  readonly lotCode: string;
  readonly receivedDate: string;
  readonly expiryDate: string | null;
  readonly quantityOnHand: string;
  readonly status: "ACTIVE" | "BLOCKED" | "CONSUMED";
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
      const out = this.appendMovement({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        movementId: uuidV7(),
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

      const entry = this.appendMovement({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        movementId: uuidV7(),
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
    return this.database.native.transaction((): ReceiveLotOutcome => {
      const existing = this.database.native.prepare(
        `SELECT id, manufactured_date, expiry_date, quantity_on_hand, status
           FROM inventory_lot
          WHERE tenant_id=? AND presentation_id=? AND lot_code=?`,
      ).get(input.scope.tenantId, input.presentationId, input.lotCode) as {
        id: string; manufactured_date: string | null; expiry_date: string | null;
        quantity_on_hand: string; status: string;
      } | undefined;

      if (existing !== undefined
        && (existing.expiry_date !== input.expiryDate
          || existing.manufactured_date !== input.manufacturedDate)) {
        return { kind: "LOT_CODE_CONFLICT" };
      }

      const movement = this.appendMovement({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        movementId: uuidV7(),
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
          if (String(error).includes("CHECK")) return { kind: "LOT_DATES_INVALID" };
          throw error;
        }
      } else {
        this.database.native.prepare(
          "UPDATE inventory_lot SET quantity_on_hand=?, updated_at=? WHERE tenant_id=? AND id=?",
        ).run(lotQuantity, at, input.scope.tenantId, lotId);
      }

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

  /** Abre la transacción que `appendMovement` no abre. Para las entradas y los ajustes. */
  appendMovementInTransaction(input: AppendMovementInput): AppendMovementOutcome {
    return this.database.native.transaction(
      (): AppendMovementOutcome => this.appendMovement(input),
    )();
  }
}