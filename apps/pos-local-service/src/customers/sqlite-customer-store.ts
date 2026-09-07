import type { FiscalCustomer } from "@pos-platform/fiscal-adapters";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";

/**
 * Persistencia del adquiriente — `D-9`.
 *
 * Guarda **la forma canónica de `FiscalCustomer` y ninguna otra**. No hay un
 * segundo modelo de cliente en el POS: dos formas del mismo tercero acabarían
 * discrepando, y la que discrepe cuando se emite una factura es la que va en el
 * documento fiscal. Por eso este almacén importa el tipo del paquete fiscal en
 * vez de declarar el suyo.
 *
 * ## Qué NO valida
 *
 * Nada de las reglas del adquiriente. Eso lo hace `validateFiscalCustomer`
 * **antes** de llegar aquí, porque un hallazgo tiene que poder devolverse al
 * operador con su código y su ruta, y una restricción de SQLite sólo lanza. Las
 * restricciones de `MIGRATION_012` son la última línea, no la primera.
 */

const CUSTOMER_PAYLOAD_SCHEMA_VERSION = "1.0.0";

/** Alcance del adquiriente: compañía. Un tercero no pertenece a una caja. */
export interface CustomerScope {
  readonly tenantId: string;
  readonly companyId: string;
}

export interface RegisterCustomerInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly customerId: string;
  readonly operationId: string;
  readonly customer: FiscalCustomer;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterCustomerOutcome =
  | { readonly kind: "REGISTERED"; readonly customerId: string; readonly version: number }
  | { readonly kind: "IDEMPOTENT"; readonly customerId: string; readonly version: number }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "IDENTITY_ALREADY_REGISTERED"; readonly customerId: string };

export interface StoredCustomer {
  readonly customerId: string;
  readonly customer: FiscalCustomer;
  readonly version: number;
}

interface CustomerRow {
  id: string;
  identification_document_code: string;
  identification: string;
  verification_digit: string | null;
  legal_organization_code: string;
  company: string | null;
  names: string | null;
  tribute_code: string;
  fiscal_responsibility_codes: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  country_code: string | null;
  municipality_code: string | null;
  version: number;
}

interface NextSequenceRow {
  next_sequence: number;
}

/**
 * Los códigos de responsabilidad fiscal se guardan como texto JSON porque
 * SQLite no tiene tipo array. `MIGRATION_012` exige `json_type(...) = 'array'`,
 * así que una cadena suelta no puede llegar aquí, pero el tipo de retorno se
 * estrecha explícitamente: un `JSON.parse` devuelve `any` y dejarlo pasar
 * convertiría cualquier contenido en una lista de códigos sin que nada proteste.
 */
function parseResponsibilityCodes(raw: string): readonly string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

function toCustomer(row: CustomerRow): FiscalCustomer {
  return {
    identificationDocumentCode: row.identification_document_code,
    identification: row.identification,
    verificationDigit: row.verification_digit,
    legalOrganizationCode: row.legal_organization_code,
    company: row.company,
    names: row.names,
    tributeCode: row.tribute_code,
    fiscalResponsibilityCodes: parseResponsibilityCodes(row.fiscal_responsibility_codes),
    email: row.email,
    phone: row.phone,
    address: row.address,
    countryCode: row.country_code,
    municipalityCode: row.municipality_code,
  };
}

export class SqliteCustomerStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  register(input: RegisterCustomerInput): RegisterCustomerOutcome {
    return this.database.native.transaction((): RegisterCustomerOutcome => {
      const nowIso = this.now().toISOString();

      // 1. Idempotencia de la operación, **antes** de escribir. Dejar que salte
      //    la restricción UNIQUE convertiría una repetición legítima en una
      //    excepción que el canal traduce en destrucción del socket.
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;

      if (operation !== undefined) {
        if (operation.payload_checksum !== input.requestChecksum) {
          return { kind: "IDEMPOTENCY_CONFLICT" };
        }
        const existing = this.database.native.prepare(
          "SELECT id, version FROM customers_customers WHERE tenant_id=? AND idempotency_key=?",
        ).get(input.scope.tenantId, input.idempotencyKey) as
          | { id: string; version: number }
          | undefined;
        if (existing === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", customerId: existing.id, version: existing.version };
      }

      // 2. Identidad del tercero. Una misma cédula dos veces con dos `id`
      //    distintos permitiría emitir contra la copia desactualizada, así que
      //    se rechaza devolviendo **cuál** es el registro que ya existe: quien
      //    captura necesita poder ir a él, no volver a intentarlo.
      const duplicate = this.database.native.prepare(
        `SELECT id FROM customers_customers
         WHERE tenant_id=? AND company_id=?
           AND identification_document_code=? AND identification=?`,
      ).get(
        input.scope.tenantId,
        input.scope.companyId,
        input.customer.identificationDocumentCode,
        input.customer.identification,
      ) as { id: string } | undefined;

      if (duplicate !== undefined) {
        return { kind: "IDENTITY_ALREADY_REGISTERED", customerId: duplicate.id };
      }

      this.database.native.prepare(
        `INSERT INTO customers_customers(
          id, tenant_id, company_id,
          identification_document_code, identification, verification_digit,
          legal_organization_code, company, names,
          tribute_code, fiscal_responsibility_codes,
          email, phone, address, country_code, municipality_code,
          origin_device_id, installation_id,
          registered_by_actor_type, registered_by_actor_id,
          idempotency_key, request_checksum, correlation_id, causation_id,
          version, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'USER',?,?,?,?,?,1,?,?)`,
      ).run(
        input.customerId,
        input.scope.tenantId,
        input.scope.companyId,
        input.customer.identificationDocumentCode,
        input.customer.identification,
        input.customer.verificationDigit,
        input.customer.legalOrganizationCode,
        input.customer.company,
        input.customer.names,
        input.customer.tributeCode,
        canonicalJson([...input.customer.fiscalResponsibilityCodes]),
        input.customer.email,
        input.customer.phone,
        input.customer.address,
        input.customer.countryCode,
        input.customer.municipalityCode,
        input.scope.deviceId,
        input.scope.installationId,
        input.operatorUserId,
        input.idempotencyKey,
        input.requestChecksum,
        input.correlationId,
        input.causationId,
        nowIso,
        nowIso,
      );

      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','REGISTERED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);

      // 3. Auditoría. **Registra qué se hizo, no con qué datos**: la
      //    identificación, el correo, el teléfono y la dirección de un tercero
      //    no entran en el rastro. La misma regla que impide que un hallazgo de
      //    validación lleve el valor del campo.
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CUSTOMER_REGISTER','CUSTOMER',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
        input.operatorUserId, input.sessionId,
        input.customerId,
        input.correlationId, input.causationId,
        canonicalJson({
          identification_document_code: input.customer.identificationDocumentCode,
          legal_organization_code: input.customer.legalOrganizationCode,
        }),
        nowIso,
      );

      this.enqueue(input, nowIso);

      return { kind: "REGISTERED", customerId: input.customerId, version: 1 };
    })();
  }

  get(scope: CustomerScope, customerId: string): StoredCustomer | null {
    const row = this.database.native.prepare(
      `SELECT id, identification_document_code, identification, verification_digit,
              legal_organization_code, company, names, tribute_code,
              fiscal_responsibility_codes, email, phone, address,
              country_code, municipality_code, version
       FROM customers_customers WHERE tenant_id=? AND company_id=? AND id=?`,
    ).get(scope.tenantId, scope.companyId, customerId) as CustomerRow | undefined;

    if (row === undefined) return null;
    return { customerId: row.id, customer: toCustomer(row), version: row.version };
  }

  /**
   * Busca por identidad fiscal, que es como lo busca una caja: el cliente da su
   * cédula, no un UUID.
   */
  findByIdentity(
    scope: CustomerScope,
    identificationDocumentCode: string,
    identification: string,
  ): StoredCustomer | null {
    const row = this.database.native.prepare(
      `SELECT id, identification_document_code, identification, verification_digit,
              legal_organization_code, company, names, tribute_code,
              fiscal_responsibility_codes, email, phone, address,
              country_code, municipality_code, version
       FROM customers_customers
       WHERE tenant_id=? AND company_id=?
         AND identification_document_code=? AND identification=?`,
    ).get(
      scope.tenantId, scope.companyId, identificationDocumentCode, identification,
    ) as CustomerRow | undefined;

    if (row === undefined) return null;
    return { customerId: row.id, customer: toCustomer(row), version: row.version };
  }

  /**
   * Encola el hecho para sincronización.
   *
   * El payload lleva **la identidad fiscal completa**, a diferencia de la
   * auditoría: el central necesita el tercero para poder emitir, y el outbox es
   * un canal de datos, no un rastro de acciones. Son dos destinos con dos
   * necesidades distintas y por eso no comparten contenido.
   */
  private enqueue(input: RegisterCustomerInput, nowIso: string): void {
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
      aggregate_type: "CUSTOMER",
      aggregate_id: input.customerId,
      operation_type: "CUSTOMER_REGISTER",
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: input.idempotencyKey,
      expected_version: null,
      payload_schema_version: CUSTOMER_PAYLOAD_SCHEMA_VERSION,
      payload: {
        customer_id: input.customerId,
        identification_document_code: input.customer.identificationDocumentCode,
        identification: input.customer.identification,
        verification_digit: input.customer.verificationDigit,
        legal_organization_code: input.customer.legalOrganizationCode,
        company: input.customer.company,
        names: input.customer.names,
        tribute_code: input.customer.tributeCode,
        fiscal_responsibility_codes: [...input.customer.fiscalResponsibilityCodes],
        email: input.customer.email,
        phone: input.customer.phone,
        address: input.customer.address,
        country_code: input.customer.countryCode,
        municipality_code: input.customer.municipalityCode,
      },
      payload_checksum: input.requestChecksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }
}
