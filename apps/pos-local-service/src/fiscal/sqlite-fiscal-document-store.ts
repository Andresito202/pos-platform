import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  evaluateRangeValidity,
  selectRangesForDocumentType,
  type FiscalDocumentType,
  type FiscalEnvironment,
  type FiscalProvider,
  type NormalizedResult,
  type NumberingRangeSnapshot,
  type TransportStatus,
} from "@pos-platform/fiscal-adapters";
import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Persistencia de `MIGRATION_016` (`DEC-021` F1/F4).
 *
 * Cada método corresponde a **un** movimiento legal de la máquina de estados
 * que la propia migración impone con `CHECK` y triggers: este store no repite
 * esas reglas, las respeta. Si un método intentara escribir un estado
 * incoherente, la base lo rechaza — la doble comprobación es intencional, no
 * redundante: el tipo protege al programa, el `CHECK` protege al fichero
 * (mismo criterio que `factus-bill-assembly.ts`).
 */

export interface DocumentScope {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
}

// ── Rangos de numeración ─────────────────────────────────────────────────────

/**
 * Reemplaza el conjunto de rangos sincronizados para `(proveedor, ambiente)`.
 *
 * Es una sustitución completa, no una fusión: el proveedor es la única
 * autoridad sobre qué rangos existen (`NumberingRangePort` lo declara), así que
 * un rango que dejó de aparecer en la sincronización más reciente deja de
 * existir aquí también. No hay estado local que preservar entre dos
 * sincronizaciones.
 */
export interface ReplaceRangesInput {
  readonly scope: DocumentScope;
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  readonly ranges: readonly NumberingRangeSnapshot[];
  readonly synchronizedAt: string;
}

function toBit(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

function fromBit(value: number | null): boolean | null {
  if (value === null) return null;
  return value === 1;
}

interface RangeRow {
  range_id: string; document_type: string; prefix: string; authority: string;
  resolution_number: string | null; range_from: number; range_to: number;
  current_number: number | null; valid_from: string | null; valid_until: string | null;
  provider_active: number | null; provider_expired: number | null;
  provider_document_code: string | null;
}

function toSnapshot(row: RangeRow): NumberingRangeSnapshot {
  return {
    rangeId: row.range_id,
    documentType: row.document_type as FiscalDocumentType,
    prefix: row.prefix,
    authority: row.authority as NumberingRangeSnapshot["authority"],
    resolutionNumber: row.resolution_number,
    rangeFrom: row.range_from,
    rangeTo: row.range_to,
    currentNumber: row.current_number,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    providerActive: fromBit(row.provider_active),
    providerExpired: fromBit(row.provider_expired),
    providerDocumentCode: row.provider_document_code,
  };
}

export type NumberingRangeSelection =
  | { readonly kind: "FOUND"; readonly range: NumberingRangeSnapshot }
  /** Ningún rango sincronizado declara este tipo documental. */
  | { readonly kind: "NOT_SYNCHRONIZED" }
  /** Hay rangos del tipo, pero ninguno vigente según `evaluateRangeValidity`. */
  | { readonly kind: "NO_VALID_RANGE"; readonly candidates: readonly NumberingRangeSnapshot[] };

export class SqliteFiscalDocumentStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  replaceRanges(input: ReplaceRangesInput): void {
    const { scope, provider, environment } = input;
    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "DELETE FROM fiscal_numbering_range WHERE tenant_id=? AND provider=? AND environment=?",
      ).run(scope.tenantId, provider, environment);

      const insert = this.database.native.prepare(`
        INSERT INTO fiscal_numbering_range(
          tenant_id,company_id,provider,environment,range_id,document_type,prefix,authority,
          resolution_number,range_from,range_to,current_number,valid_from,valid_until,
          provider_active,provider_expired,provider_document_code,synchronized_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const range of input.ranges) {
        insert.run(
          scope.tenantId, scope.companyId, provider, environment,
          range.rangeId, range.documentType, range.prefix, range.authority,
          range.resolutionNumber, range.rangeFrom, range.rangeTo, range.currentNumber,
          range.validFrom, range.validUntil,
          toBit(range.providerActive), toBit(range.providerExpired), range.providerDocumentCode,
          input.synchronizedAt,
        );
      }
    });
    transaction();
  }

  /**
   * Elige el rango que se usaría para emitir ahora.
   *
   * Reutiliza `selectRangesForDocumentType` y `evaluateRangeValidity`, los
   * mismos predicados que ya prueba `numbering-range-port.ts`: no se repite su
   * lógica, se aplica sobre lo persistido. Entre varios candidatos vigentes,
   * elige el de mayor `rangeTo` — el de mayor capacidad restante declarada— por
   * ser el criterio más simple que no requiere adivinar preferencia del
   * operador; si el proyecto necesita otro criterio, es una decisión aparte.
   */
  selectRange(
    scope: DocumentScope,
    provider: FiscalProvider,
    environment: FiscalEnvironment,
    documentType: FiscalDocumentType,
    atIso: string = this.now().toISOString(),
  ): NumberingRangeSelection {
    const rows = this.database.native.prepare(
      `SELECT range_id, document_type, prefix, authority, resolution_number, range_from, range_to,
              current_number, valid_from, valid_until, provider_active, provider_expired,
              provider_document_code
         FROM fiscal_numbering_range
        WHERE tenant_id=? AND provider=? AND environment=?`,
    ).all(scope.tenantId, provider, environment) as RangeRow[];

    const { matching } = selectRangesForDocumentType(rows.map(toSnapshot), documentType);
    if (matching.length === 0) return { kind: "NOT_SYNCHRONIZED" };

    const valid = matching.filter((range) => evaluateRangeValidity(range, atIso) === "VALID");
    if (valid.length === 0) return { kind: "NO_VALID_RANGE", candidates: matching };

    const chosen = valid.reduce((best, range) => (range.rangeTo > best.rangeTo ? range : best));
    return { kind: "FOUND", range: chosen };
  }

  // ── Documento electrónico ──────────────────────────────────────────────────

  /**
   * Recupera el documento vivo de `(venta, tipo)`, si existe.
   *
   * «Vivo» es exactamente lo que impone
   * `fiscal_electronic_document_open_per_sale_idx`: no cancelado y no
   * rechazado. Esta consulta existe para que el caso de uso pregunte antes de
   * intentar insertar, y así convertir la violación de índice en una decisión
   * legible en vez de una excepción de SQLite.
   */
  findOpenForSale(
    scope: DocumentScope,
    saleId: string,
    documentType: FiscalDocumentType,
  ): StoredElectronicDocument | null {
    const row = this.database.native.prepare(
      `${SELECT_DOCUMENT}
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND sale_id=? AND document_type=?
          AND transport_status<>'CANCELLED'
          AND (normalized_result IS NULL OR normalized_result<>'REJECTED')`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, saleId, documentType) as DocumentRow | undefined;
    return row === undefined ? null : toDocument(row);
  }

  findByIdempotencyKey(
    scope: DocumentScope,
    provider: FiscalProvider,
    environment: FiscalEnvironment,
    idempotencyKey: string,
  ): StoredElectronicDocument | null {
    const row = this.database.native.prepare(
      `${SELECT_DOCUMENT}
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND provider=? AND environment=? AND idempotency_key=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, provider, environment, idempotencyKey) as DocumentRow | undefined;
    return row === undefined ? null : toDocument(row);
  }

  /**
   * Crea el documento en `CREATED`: identidad, `idempotency_key` y payload
   * congelado, **antes de cualquier intento de transmisión** (`DEC-021` §2.1).
   *
   * `attempt_count=0` y `first_submitted_at=NULL` son los que `MIGRATION_016`
   * exige para `CREATED`; no transmitir todavía es lo que distingue esta
   * llamada de `markInProgress`.
   */
  create(input: CreateDocumentInput): StoredElectronicDocument {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    this.database.native.prepare(`
      INSERT INTO fiscal_electronic_document(
        id,tenant_id,company_id,branch_id,sale_id,provider,environment,document_type,
        numbering_range_id,idempotency_key,payload_json,payload_checksum,
        transport_status,normalized_result,attempt_count,
        provider_operation_id,provider_document_id,issued_prefix,issued_number,cufe,
        provider_status_code,provider_status,provider_http_status,
        last_diagnostic_code,last_diagnostic_reference,
        version,created_at,updated_at,first_submitted_at,resolved_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,
        ?,?,?,?,
        'CREATED',NULL,0,
        NULL,NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,
        NULL,NULL,
        1,?,?,NULL,NULL
      )
    `).run(
      id, input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.saleId,
      input.provider, input.environment, input.documentType,
      input.numberingRangeId, input.idempotencyKey, input.payloadJson, input.payloadChecksum,
      createdAt, createdAt,
    );
    const created = this.findByIdempotencyKey(input.scope, input.provider, input.environment, input.idempotencyKey);
    if (created === null) throw new Error("fiscal document vanished immediately after insert");
    return created;
  }

  /**
   * `CREATED|FAILED|UNKNOWN_OUTCOME → IN_PROGRESS`, con `attempt_count+1`.
   *
   * Es el único punto donde el intento avanza, y avanza **antes** de llamar al
   * puerto de emisión: si el proceso muriera entre esta escritura y la
   * respuesta del proveedor, el documento queda en disco como
   * `IN_PROGRESS`/intento ya consumido, no como si nunca se hubiera intentado.
   */
  markInProgress(scope: DocumentScope, documentId: string, at: string = this.now().toISOString()): void {
    const changes = this.database.native.prepare(`
      UPDATE fiscal_electronic_document
         SET transport_status='IN_PROGRESS', attempt_count=attempt_count+1,
             first_submitted_at=COALESCE(first_submitted_at, ?),
             version=version+1, updated_at=?
       WHERE tenant_id=? AND id=? AND transport_status IN ('CREATED','FAILED','UNKNOWN_OUTCOME')
    `).run(at, at, scope.tenantId, documentId).changes;
    if (changes !== 1) {
      throw new Error("fiscal document is not in a state that can start a new attempt");
    }
  }

  /** `IN_PROGRESS → COMPLETED`, con el resultado evidenciado del proveedor. */
  recordCompleted(input: RecordCompletedInput): void {
    const at = this.now().toISOString();
    const changes = this.database.native.prepare(`
      UPDATE fiscal_electronic_document
         SET transport_status='COMPLETED', normalized_result=?,
             provider_operation_id=?, provider_document_id=?, issued_prefix=?, issued_number=?, cufe=?,
             provider_status_code=?, provider_status=?, provider_http_status=?,
             version=version+1, updated_at=?, resolved_at=?
       WHERE tenant_id=? AND id=? AND transport_status='IN_PROGRESS'
    `).run(
      input.normalizedResult,
      input.providerOperationId, input.providerDocumentId, input.issuedPrefix, input.issuedNumber, input.cufe,
      input.providerStatusCode, input.providerStatus, input.providerHttpStatus,
      at, at,
      input.scope.tenantId, input.documentId,
    ).changes;
    if (changes !== 1) throw new Error("fiscal document is not IN_PROGRESS");
  }

  /** `IN_PROGRESS → FAILED`. No es terminal: admite un intento posterior. */
  recordFailed(input: RecordDiagnosticInput): void {
    this.transition(input, "FAILED");
  }

  /**
   * `IN_PROGRESS → UNKNOWN_OUTCOME`.
   *
   * Regla 5 de §Idempotencia: un timeout después de transmitir aterriza aquí,
   * nunca en `COMPLETED` con un resultado inferido. Tampoco es terminal —lo
   * impide `MIGRATION_016` con su `CHECK` sobre `resolved_at`— porque la regla
   * 10 exige que sólo la reconciliación, nunca el reintento automático, lo
   * mueva a `ACCEPTED`/`REJECTED`.
   */
  recordUnknownOutcome(input: RecordDiagnosticInput): void {
    this.transition(input, "UNKNOWN_OUTCOME");
  }

  private transition(input: RecordDiagnosticInput, status: "FAILED" | "UNKNOWN_OUTCOME"): void {
    const at = this.now().toISOString();
    const changes = this.database.native.prepare(`
      UPDATE fiscal_electronic_document
         SET transport_status=?, last_diagnostic_code=?, last_diagnostic_reference=?,
             provider_status_code=?, provider_status=?, provider_http_status=?,
             version=version+1, updated_at=?
       WHERE tenant_id=? AND id=? AND transport_status='IN_PROGRESS'
    `).run(
      status, input.diagnosticCode, input.diagnosticReference,
      input.providerStatusCode, input.providerStatus, input.providerHttpStatus,
      at,
      input.scope.tenantId, input.documentId,
    ).changes;
    if (changes !== 1) throw new Error(`fiscal document is not IN_PROGRESS (${status})`);
  }
}

const SELECT_DOCUMENT = `
  SELECT id, tenant_id, company_id, branch_id, sale_id, provider, environment, document_type,
         numbering_range_id, idempotency_key, payload_json, payload_checksum,
         transport_status, normalized_result, attempt_count,
         provider_operation_id, provider_document_id, issued_prefix, issued_number, cufe,
         provider_status_code, provider_status, provider_http_status,
         last_diagnostic_code, last_diagnostic_reference,
         version, created_at, updated_at, first_submitted_at, resolved_at
    FROM fiscal_electronic_document
`.trim();

interface DocumentRow {
  id: string; tenant_id: string; company_id: string; branch_id: string; sale_id: string;
  provider: string; environment: string; document_type: string;
  numbering_range_id: string; idempotency_key: string; payload_json: string; payload_checksum: string;
  transport_status: string; normalized_result: string | null; attempt_count: number;
  provider_operation_id: string | null; provider_document_id: string | null;
  issued_prefix: string | null; issued_number: string | null; cufe: string | null;
  provider_status_code: string | null; provider_status: string | null; provider_http_status: number | null;
  last_diagnostic_code: string | null; last_diagnostic_reference: string | null;
  version: number; created_at: string; updated_at: string;
  first_submitted_at: string | null; resolved_at: string | null;
}

export interface StoredElectronicDocument {
  readonly id: string;
  readonly saleId: string;
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  readonly documentType: FiscalDocumentType;
  readonly numberingRangeId: string;
  readonly idempotencyKey: string;
  readonly payloadJson: string;
  readonly payloadChecksum: string;
  readonly transportStatus: TransportStatus;
  readonly normalizedResult: NormalizedResult | null;
  readonly attemptCount: number;
  readonly cufe: string | null;
  readonly issuedPrefix: string | null;
  readonly issuedNumber: string | null;
  readonly version: number;
  readonly resolvedAt: string | null;
}

function toDocument(row: DocumentRow): StoredElectronicDocument {
  return {
    id: row.id,
    saleId: row.sale_id,
    provider: row.provider as FiscalProvider,
    environment: row.environment as FiscalEnvironment,
    documentType: row.document_type as FiscalDocumentType,
    numberingRangeId: row.numbering_range_id,
    idempotencyKey: row.idempotency_key,
    payloadJson: row.payload_json,
    payloadChecksum: row.payload_checksum,
    transportStatus: row.transport_status as TransportStatus,
    normalizedResult: row.normalized_result as NormalizedResult | null,
    attemptCount: row.attempt_count,
    cufe: row.cufe,
    issuedPrefix: row.issued_prefix,
    issuedNumber: row.issued_number,
    version: row.version,
    resolvedAt: row.resolved_at,
  };
}

export interface CreateDocumentInput {
  readonly scope: DocumentScope;
  readonly saleId: string;
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  readonly documentType: FiscalDocumentType;
  readonly numberingRangeId: string;
  readonly idempotencyKey: string;
  readonly payloadJson: string;
  readonly payloadChecksum: string;
}

export interface RecordCompletedInput {
  readonly scope: DocumentScope;
  readonly documentId: string;
  readonly normalizedResult: NormalizedResult;
  readonly providerOperationId: string;
  readonly providerDocumentId: string | null;
  readonly issuedPrefix: string | null;
  readonly issuedNumber: string | null;
  readonly cufe: string | null;
  readonly providerStatusCode: string | null;
  readonly providerStatus: string | null;
  readonly providerHttpStatus: number | null;
}

export interface RecordDiagnosticInput {
  readonly scope: DocumentScope;
  readonly documentId: string;
  readonly diagnosticCode: string;
  readonly diagnosticReference: string;
  readonly providerStatusCode: string | null;
  readonly providerStatus: string | null;
  readonly providerHttpStatus: number | null;
}
