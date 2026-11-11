import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  type CredentialReference,
  type DocumentIssuanceOutcome,
  type DocumentIssuancePort,
  type DocumentIssuanceRequest,
  type FiscalCustomer,
  type FiscalCustomerResolution,
  type FrozenDocumentPayload,
  type NumberingRangeOutcome,
  type NumberingRangePort,
  type NumberingRangeQuery,
  type PayloadValidationResult,
} from "@pos-platform/fiscal-adapters";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import {
  SqliteFiscalDocumentStore,
  type DocumentScope,
} from "../src/fiscal/sqlite-fiscal-document-store.js";
import { SqliteFiscalSaleSource } from "../src/fiscal/fiscal-sale-source.js";
import { mapPaymentMethodToDian } from "../src/fiscal/payment-method-mapping.js";
import { SynchronizeNumberingRangesUseCase } from "../src/fiscal/synchronize-numbering-ranges-use-case.js";
import {
  IssueElectronicDocumentUseCase,
  PERMISSION_FISCAL_DOCUMENT_ISSUE,
  type IssueElectronicDocumentInput,
} from "../src/fiscal/issue-electronic-document-use-case.js";

/**
 * `DEC-021` F4 — el caso de uso de emisión completo.
 *
 * Éstas son las pruebas que faltaban: F1–F3 ya tenían cobertura, pero nada
 * ejecutaba el tramo que las junta. Cada escenario cita la regla de
 * `docs/architecture/electronic-invoicing.md` §«Idempotencia y resultado
 * incierto» que verifica, para que una lectura futura pueda comprobarlas una
 * a una.
 */

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const USER = "018f0000-0000-7000-8000-000000000006";
const NOW = new Date("2026-09-14T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

const SCOPE: DocumentScope = { tenantId: TENANT, companyId: COMPANY, branchId: BRANCH };

const PROVIDER = "FACTUS" as const;
const ENVIRONMENT = "SANDBOX" as const;
const DOCUMENT_TYPE = "SALES_INVOICE" as const;
const RANGE_ID = "FACTUS-RANGE-1";
const CREDENTIAL: CredentialReference = { secretRef: "fiscal:FACTUS:SANDBOX", version: "v1" };

function auth(permissions: readonly string[] = [PERMISSION_FISCAL_DOCUMENT_ISSUE]): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER,
    installation_id: "018f0000-0000-7000-8000-000000000005",
    device_id: "018f0000-0000-7000-8000-000000000004",
    sequence: 1,
    issued_at: "2026-09-14T00:00:00.000Z",
    expires_at: "2026-09-15T00:00:00.000Z",
    key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW_ISO };
}

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* un cierre fallido no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function openDatabase(): Promise<LocalDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "pos-fiscal-issuance-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  return database;
}

// ── Siembra ──────────────────────────────────────────────────────────────────

function seedRange(database: LocalDatabase, overrides: Record<string, unknown> = {}): void {
  const row = {
    tenant_id: TENANT, company_id: COMPANY, provider: PROVIDER, environment: ENVIRONMENT,
    range_id: RANGE_ID, document_type: DOCUMENT_TYPE, prefix: "SETP", authority: "PROVIDER",
    resolution_number: "18760000001", range_from: 1, range_to: 5000, current_number: 12,
    valid_from: "2026-01-01", valid_until: "2027-01-01",
    provider_active: 1, provider_expired: 0, provider_document_code: "01",
    synchronized_at: NOW_ISO,
    ...overrides,
  };
  database.native.prepare(`
    INSERT INTO fiscal_numbering_range(
      tenant_id,company_id,provider,environment,range_id,document_type,prefix,authority,
      resolution_number,range_from,range_to,current_number,valid_from,valid_until,
      provider_active,provider_expired,provider_document_code,synchronized_at
    ) VALUES (
      @tenant_id,@company_id,@provider,@environment,@range_id,@document_type,@prefix,@authority,
      @resolution_number,@range_from,@range_to,@current_number,@valid_from,@valid_until,
      @provider_active,@provider_expired,@provider_document_code,@synchronized_at
    )`).run(row);
}

let saleCounter = 0;

/** Venta cobrada mínima, con su operación de runtime, para satisfacer la FK. */
function seedSale(database: LocalDatabase, saleId: string = randomUUID()): string {
  const operationId = randomUUID();
  saleCounter += 1;
  database.native.prepare(`
    INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
    VALUES (?,?,?,'SUCCEEDED','COMMITTED',?,?)`,
  ).run(operationId, `sale:${saleId}`, "b".repeat(64), NOW_ISO, NOW_ISO);

  database.native.prepare(`
    INSERT INTO sales_sales(
      id,tenant_id,company_id,branch_id,cash_register_id,cash_shift_id,origin_device_id,installation_id,
      operator_actor_type,operator_actor_id,channel,status,business_date,timezone_id,utc_offset_minutes,
      document_series,sale_number,currency_code,subtotal_amount,discount_amount,tax_amount,
      fiscal_total_amount,commercial_rounding_adjustment,payable_amount,pricing_pipeline_version,
      pricing_policy_version,promotion_policy_version,tax_policy_version,rounding_policy_version,
      pricing_snapshot,tax_snapshot,calculation_checksum,operation_id,idempotency_key,request_checksum,
      correlation_id,causation_id,version,created_at,completed_at,cancelled_at,expired_at,server_recorded_at
    ) VALUES (
      ?,?,?,?,NULL,NULL,?,?,
      'USER',?,'POS','COMPLETED','2026-09-14','America/Bogota',-300,
      'SETP',?,'COP','42648.000000','0.000000','4742.000000',
      '47390.000000','10.000000','47400.000000','1.0.0',
      '1.0.0',NULL,'1.0.0','1.0.0',
      '{}','{}',?,?,?,?,
      ?,NULL,1,?,?,NULL,NULL,NULL
    )`,
  ).run(
    saleId, TENANT, COMPANY, BRANCH, "018f0000-0000-7000-8000-000000000004", "018f0000-0000-7000-8000-000000000005",
    "018f0000-0000-7000-8000-000000000006", saleCounter,
    `c${saleCounter}`.padEnd(64, "0"), operationId, `sale:${saleId}`, `d${saleCounter}`.padEnd(64, "0"),
    randomUUID(), NOW_ISO, NOW_ISO,
  );
  return saleId;
}

interface CatalogLineOptions {
  readonly quantity?: string;
  readonly unitPrice?: string;
  readonly discountAmount?: string;
  readonly withFiscalAttribute?: boolean;
}

/**
 * Siembra producto + presentación (+ atributo fiscal, salvo que se apague) y una
 * línea de venta. `withFiscalAttribute: false` es exactamente el escenario que
 * `LINE_FISCAL_ATTRIBUTE_MISSING` existe para bloquear.
 */
function seedCatalogLine(
  database: LocalDatabase,
  saleId: string,
  lineNumber: number,
  options: CatalogLineOptions = {},
): { productId: string; presentationId: string } {
  const productId = randomUUID();
  const presentationId = randomUUID();
  const quantity = options.quantity ?? "2.000000";
  const unitPrice = options.unitPrice ?? "5000.000000";
  const discountAmount = options.discountAmount ?? "0.000000";

  database.native.prepare(`
    INSERT INTO catalog_product(
      id, tenant_id, company_id, code, name, status, stock_controlled,
      registered_by_actor_id, idempotency_key, correlation_id, version, created_at, updated_at
    ) VALUES (?,?,?,?,'Arroz Blanco','ACTIVE',1,?,?,?,1,?,?)`,
  ).run(
    productId, TENANT, COMPANY, `ARROZ-${productId.slice(0, 8)}`,
    "018f0000-0000-7000-8000-000000000006", `catalog:${productId}`, randomUUID(), NOW_ISO, NOW_ISO,
  );

  database.native.prepare(`
    INSERT INTO catalog_presentation(
      id, tenant_id, product_id, name, unit_code, unit_precision, barcode,
      status, created_at, updated_at
    ) VALUES (?,?,?,'Libra','LBR',2,NULL,'ACTIVE',?,?)`,
  ).run(presentationId, TENANT, productId, NOW_ISO, NOW_ISO);

  if (options.withFiscalAttribute !== false) {
    database.native.prepare(`
      INSERT INTO catalog_fiscal_attribute(
        tenant_id, presentation_id, code_reference, unit_measure_code, standard_code,
        tax_code, tax_rate, status, created_at, updated_at
      ) VALUES (?,?,?,'94','999','01','19.000000','ACTIVE',?,?)`,
    ).run(TENANT, presentationId, `REF-${presentationId.slice(0, 8)}`, NOW_ISO, NOW_ISO);
  }

  database.native.prepare(`
    INSERT INTO sales_sale_items(
      id, tenant_id, sale_id, line_number,
      product_id, variant_id, presentation_id,
      product_name_snapshot, presentation_name_snapshot, identifier_snapshot,
      unit_id, unit_code_snapshot, unit_precision_snapshot,
      quantity, unit_price_amount, gross_amount,
      discount_amount, taxable_amount, tax_amount, line_total_amount,
      pricing_resolution_snapshot, tax_calculation_snapshot,
      lot_id, measurement_source_type, measurement_evidence_snapshot, measurement_evidence_checksum
    ) VALUES (
      ?,?,?,?,
      ?,NULL,?,
      'Arroz Blanco','Libra',NULL,
      ?,'LBR',2,
      ?,?,'10000.000000',
      ?,'10000.000000','1900.000000','10000.000000',
      '{}','{}',
      NULL,NULL,NULL,NULL
    )`,
  ).run(
    randomUUID(), TENANT, saleId, lineNumber,
    productId, presentationId, presentationId,
    quantity, unitPrice,
    discountAmount,
  );

  return { productId, presentationId };
}

let paymentCounter = 0;

/** Pago confirmado, directamente en las tres tablas de `payments_*`. */
function seedConfirmedPayment(database: LocalDatabase, saleId: string, method: string, amount: string): void {
  paymentCounter += 1;
  const groupId = randomUUID();
  const paymentId = randomUUID();
  const allocationId = randomUUID();

  database.native.prepare(`
    INSERT INTO payments_payment_groups(
      id, tenant_id, company_id, branch_id, collection_subject_type, collection_subject_id,
      currency_code, expected_payable_amount, idempotency_key, request_checksum,
      correlation_id, causation_id, created_at
    ) VALUES (?,?,?,?,'SALE',?,'COP',?,?,?,?,NULL,?)`,
  ).run(
    groupId, TENANT, COMPANY, BRANCH, saleId, amount,
    `paygroup:${saleId}:${String(paymentCounter)}`, "e".repeat(64), randomUUID(), NOW_ISO,
  );

  database.native.prepare(`
    INSERT INTO payments_payments(
      id, tenant_id, company_id, branch_id, payment_group_id, payment_method, authority_type, status,
      expected_amount, confirmed_amount, tendered_amount, change_amount, currency_code,
      origin_device_id, installation_id, operator_actor_type, operator_actor_id,
      confirmed_by_actor_type, confirmed_by_actor_id, provider_code, provider_reference,
      operation_id, idempotency_key, request_checksum, correlation_id, causation_id,
      version, created_at, confirmed_at, cancelled_at, server_recorded_at
    ) VALUES (
      ?,?,?,?,?,?,'LOCAL_DEVICE','CONFIRMED',
      ?,?,NULL,NULL,'COP',
      ?,?,'USER',?,
      'USER',?,NULL,NULL,
      ?,?,?,?,NULL,
      1,?,?,NULL,?
    )`,
  ).run(
    paymentId, TENANT, COMPANY, BRANCH, groupId, method,
    amount, amount,
    "018f0000-0000-7000-8000-000000000004", "018f0000-0000-7000-8000-000000000005", "018f0000-0000-7000-8000-000000000006",
    "018f0000-0000-7000-8000-000000000006",
    registerOperation(database, paymentId), `pay:${saleId}:${String(paymentCounter)}`, "f".repeat(64),
    randomUUID(),
    NOW_ISO, NOW_ISO, NOW_ISO,
  );

  database.native.prepare(`
    INSERT INTO payments_payment_allocations(
      id, tenant_id, payment_group_id, payment_id, collection_subject_type, collection_subject_id,
      amount, currency_code, allocation_sequence, created_at
    ) VALUES (?,?,?,?,'SALE',?,?,'COP',1,?)`,
  ).run(allocationId, TENANT, groupId, paymentId, saleId, amount, NOW_ISO);
}

function registerOperation(database: LocalDatabase, seed: string): string {
  const operationId = randomUUID();
  database.native.prepare(`
    INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
    VALUES (?,?,?,'SUCCEEDED','COMMITTED',?,?)`,
  ).run(operationId, `payop:${seed}`, "a".repeat(64), NOW_ISO, NOW_ISO);
  return operationId;
}

// ── Fixtures de dominio ──────────────────────────────────────────────────────

const VALID_CUSTOMER: FiscalCustomer = {
  identificationDocumentCode: "13",
  identification: "123456789",
  verificationDigit: null,
  legalOrganizationCode: "2",
  company: null,
  names: "Cliente De Prueba",
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: null,
  phone: null,
  address: null,
  countryCode: null,
  municipalityCode: null,
};
const IDENTIFIED_CUSTOMER: FiscalCustomerResolution = { kind: "IDENTIFIED", customer: VALID_CUSTOMER };
const ANONYMOUS_CUSTOMER: FiscalCustomerResolution = { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" };

function baseInput(saleId: string, overrides: Partial<IssueElectronicDocumentInput> = {}): IssueElectronicDocumentInput {
  return {
    scope: SCOPE,
    saleId,
    provider: PROVIDER,
    environment: ENVIRONMENT,
    documentType: DOCUMENT_TYPE,
    customer: IDENTIFIED_CUSTOMER,
    observation: null,
    ...overrides,
  };
}

// ── Puerto de emisión falso ──────────────────────────────────────────────────

class FakeIssuancePort implements DocumentIssuancePort {
  callCount = 0;
  private readonly outcomes: DocumentIssuanceOutcome[];
  readonly requests: DocumentIssuanceRequest[] = [];

  constructor(...outcomes: DocumentIssuanceOutcome[]) {
    this.outcomes = outcomes;
  }

  validatePayload(_document: FrozenDocumentPayload): Promise<PayloadValidationResult> {
    return Promise.resolve({ kind: "VALID" });
  }

  issue(request: DocumentIssuanceRequest, _signal: AbortSignal): Promise<DocumentIssuanceOutcome> {
    this.callCount += 1;
    this.requests.push(request);
    const outcome = this.outcomes[this.callCount - 1];
    if (outcome === undefined) throw new Error("FakeIssuancePort ran out of scripted outcomes");
    return Promise.resolve(outcome);
  }
}

function evidenced(overrides: Partial<Extract<DocumentIssuanceOutcome, { kind: "EVIDENCED" }>> = {}): DocumentIssuanceOutcome {
  return {
    kind: "EVIDENCED",
    transportStatus: "COMPLETED",
    normalizedResult: "ACCEPTED",
    externalIdentity: {
      providerOperationId: "op-1", providerDocumentId: "doc-1",
      prefix: "SETP", number: "990000001", cufe: "a".repeat(96),
    },
    providerStatus: { providerCode: "0", providerStatus: "processed", httpStatus: 200 },
    ...overrides,
  };
}

function technicalFailure(): DocumentIssuanceOutcome {
  return {
    kind: "TECHNICAL_FAILURE",
    transportStatus: "FAILED",
    providerStatus: { providerCode: "500", providerStatus: "error", httpStatus: 500 },
    diagnostic: { code: "PROVIDER_5XX", diagnosticReference: "diag-1", retryAfterSeconds: 5 },
  };
}

function uncertain(): DocumentIssuanceOutcome {
  return {
    kind: "UNCERTAIN",
    transportStatus: "UNKNOWN_OUTCOME",
    providerStatus: null,
    diagnostic: { code: "READ_TIMEOUT", diagnosticReference: "diag-2", retryAfterSeconds: null },
  };
}

async function buildEnv(port: DocumentIssuancePort) {
  const database = await openDatabase();
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const documentStore = new SqliteFiscalDocumentStore(database, () => NOW);
  const saleSource = new SqliteFiscalSaleSource(database);
  const useCase = new IssueElectronicDocumentUseCase(saleSource, catalogStore, documentStore, port, CREDENTIAL, () => NOW);
  return { database, documentStore, saleSource, catalogStore, useCase };
}

const SIGNAL = new AbortController().signal;

// ── SqliteFiscalDocumentStore ────────────────────────────────────────────────

describe("SqliteFiscalDocumentStore — selección de rango", () => {
  it("NOT_SYNCHRONIZED cuando no hay ningún rango del tipo", async () => {
    const database = await openDatabase();
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    expect(store.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO))
      .toEqual({ kind: "NOT_SYNCHRONIZED" });
  });

  it("NO_VALID_RANGE cuando el único rango del tipo está expirado", async () => {
    const database = await openDatabase();
    seedRange(database, { provider_expired: 1, provider_active: 0 });
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    const result = store.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO);
    expect(result.kind).toBe("NO_VALID_RANGE");
  });

  it("FOUND elige, entre varios vigentes, el de mayor range_to", async () => {
    const database = await openDatabase();
    seedRange(database, { range_id: "R-SMALL", range_to: 100 });
    seedRange(database, { range_id: "R-BIG", range_to: 9000 });
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    const result = store.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO);
    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") expect(result.range.rangeId).toBe("R-BIG");
  });

  it("replaceRanges sustituye por completo: un rango que deja de aparecer desaparece", async () => {
    const database = await openDatabase();
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    store.replaceRanges({
      scope: SCOPE, provider: PROVIDER, environment: ENVIRONMENT, synchronizedAt: NOW_ISO,
      ranges: [{
        rangeId: "R1", documentType: DOCUMENT_TYPE, prefix: "SETP", authority: "PROVIDER",
        resolutionNumber: "1", rangeFrom: 1, rangeTo: 100, currentNumber: 0,
        validFrom: null, validUntil: null, providerActive: true, providerExpired: false, providerDocumentCode: "01",
      }],
    });
    expect(store.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO).kind).toBe("FOUND");

    store.replaceRanges({
      scope: SCOPE, provider: PROVIDER, environment: ENVIRONMENT, synchronizedAt: NOW_ISO, ranges: [],
    });
    expect(store.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO)).toEqual({ kind: "NOT_SYNCHRONIZED" });
  });
});

describe("SqliteFiscalDocumentStore — máquina de estados", () => {
  it("create dejar el documento en CREATED con intento cero", async () => {
    const database = await openDatabase();
    seedRange(database);
    const saleId = seedSale(database);
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    const document = store.create({
      scope: SCOPE, saleId, provider: PROVIDER, environment: ENVIRONMENT, documentType: DOCUMENT_TYPE,
      numberingRangeId: RANGE_ID, idempotencyKey: `${saleId}:${DOCUMENT_TYPE}`,
      payloadJson: "{}", payloadChecksum: "a".repeat(64),
    });
    expect(document.transportStatus).toBe("CREATED");
    expect(document.attemptCount).toBe(0);
  });

  it("markInProgress incrementa el intento y sólo procede desde CREATED, FAILED o UNKNOWN_OUTCOME", async () => {
    const database = await openDatabase();
    seedRange(database);
    const saleId = seedSale(database);
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    const document = store.create({
      scope: SCOPE, saleId, provider: PROVIDER, environment: ENVIRONMENT, documentType: DOCUMENT_TYPE,
      numberingRangeId: RANGE_ID, idempotencyKey: `${saleId}:${DOCUMENT_TYPE}`,
      payloadJson: "{}", payloadChecksum: "a".repeat(64),
    });
    for (const foreignScope of [{ ...SCOPE, companyId: randomUUID() }, { ...SCOPE, branchId: randomUUID() }]) {
      expect(store.findOpenForSale(foreignScope, saleId, DOCUMENT_TYPE)).toBeNull();
      expect(store.findByIdempotencyKey(foreignScope, PROVIDER, ENVIRONMENT, document.idempotencyKey)).toBeNull();
    }
    store.markInProgress(SCOPE, document.id, NOW_ISO);
    const reloaded = store.findByIdempotencyKey(SCOPE, PROVIDER, ENVIRONMENT, document.idempotencyKey);
    expect(reloaded?.transportStatus).toBe("IN_PROGRESS");
    expect(reloaded?.attemptCount).toBe(1);

    // Ya está IN_PROGRESS: un segundo intento no es una transición legal.
    expect(() => store.markInProgress(SCOPE, document.id, NOW_ISO)).toThrow();
  });

  it("recordCompleted sólo procede desde IN_PROGRESS", async () => {
    const database = await openDatabase();
    seedRange(database);
    const saleId = seedSale(database);
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    const document = store.create({
      scope: SCOPE, saleId, provider: PROVIDER, environment: ENVIRONMENT, documentType: DOCUMENT_TYPE,
      numberingRangeId: RANGE_ID, idempotencyKey: `${saleId}:${DOCUMENT_TYPE}`,
      payloadJson: "{}", payloadChecksum: "a".repeat(64),
    });
    // Todavía en CREATED: recordCompleted debe rechazar.
    expect(() => store.recordCompleted({
      scope: SCOPE, documentId: document.id, normalizedResult: "ACCEPTED",
      providerOperationId: "op", providerDocumentId: null, issuedPrefix: "SETP", issuedNumber: "1", cufe: "a".repeat(96),
      providerStatusCode: null, providerStatus: null, providerHttpStatus: null,
    })).toThrow();
  });

  it("findOpenForSale ignora documentos CANCELLED y REJECTED", async () => {
    const database = await openDatabase();
    seedRange(database);
    const saleId = seedSale(database);
    const store = new SqliteFiscalDocumentStore(database, () => NOW);
    const document = store.create({
      scope: SCOPE, saleId, provider: PROVIDER, environment: ENVIRONMENT, documentType: DOCUMENT_TYPE,
      numberingRangeId: RANGE_ID, idempotencyKey: `${saleId}:${DOCUMENT_TYPE}`,
      payloadJson: "{}", payloadChecksum: "a".repeat(64),
    });
    store.markInProgress(SCOPE, document.id, NOW_ISO);
    store.recordCompleted({
      scope: SCOPE, documentId: document.id, normalizedResult: "REJECTED",
      providerOperationId: "op", providerDocumentId: null, issuedPrefix: null, issuedNumber: null, cufe: null,
      providerStatusCode: null, providerStatus: null, providerHttpStatus: null,
    });
    // La consulta de abiertos excluye rechazos; el caso de uso recupera
    // primero la identidad persistida para no transmitir otra vez.
    expect(store.findOpenForSale(SCOPE, saleId, DOCUMENT_TYPE)).toBeNull();
  });
});

// ── mapPaymentMethodToDian ───────────────────────────────────────────────────

describe("mapPaymentMethodToDian", () => {
  it("CASH y TRANSFER tienen código DIAN verificado", () => {
    expect(mapPaymentMethodToDian("CASH")).toEqual({ paymentFormCode: "1", paymentMethodCode: "10" });
    expect(mapPaymentMethodToDian("TRANSFER")).toEqual({ paymentFormCode: "1", paymentMethodCode: "42" });
  });

  it("CARD, QR y CUSTOMER_CREDIT no tienen código DIAN verificado: null, no una suposición", () => {
    expect(mapPaymentMethodToDian("CARD")).toBeNull();
    expect(mapPaymentMethodToDian("QR")).toBeNull();
    expect(mapPaymentMethodToDian("CUSTOMER_CREDIT")).toBeNull();
  });

  it("un método desconocido tampoco se inventa", () => {
    expect(mapPaymentMethodToDian("BITCOIN")).toBeNull();
  });
});

// ── SqliteFiscalSaleSource ───────────────────────────────────────────────────

describe("SqliteFiscalSaleSource", () => {
  it("null si la venta no existe en el alcance", async () => {
    const database = await openDatabase();
    const source = new SqliteFiscalSaleSource(database);
    expect(source.read(SCOPE, randomUUID())).toBeNull();
  });

  it("null si la venta existe pero no está COMPLETED", async () => {
    const database = await openDatabase();
    const saleId = randomUUID();
    seedSale(database, saleId);
    database.native.prepare("UPDATE sales_sales SET status='READY_FOR_PAYMENT', completed_at=NULL WHERE id=?").run(saleId);
    const source = new SqliteFiscalSaleSource(database);
    expect(source.read(SCOPE, saleId)).toBeNull();
  });

  it("lee líneas y pagos confirmados de una venta cobrada", async () => {
    const database = await openDatabase();
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");
    const source = new SqliteFiscalSaleSource(database);
    const sale = source.read(SCOPE, saleId);
    expect(sale).not.toBeNull();
    expect(sale?.lines).toHaveLength(1);
    expect(sale?.payments).toEqual([{ paymentMethod: "CASH", confirmedAmount: "10000.000000" }]);
  });

  it("sólo trae pagos CONFIRMED, no otros estados", async () => {
    const database = await openDatabase();
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "5000.000000");
    // Un pago cancelado a mano: no debe aparecer.
    database.native.prepare(
      "UPDATE payments_payments SET status='CANCELLED', cancelled_at=? WHERE tenant_id=? AND confirmed_amount='5000.000000'",
    ).run(NOW_ISO, TENANT);
    const source = new SqliteFiscalSaleSource(database);
    expect(source.read(SCOPE, saleId)?.payments).toEqual([]);
  });
});

// ── SynchronizeNumberingRangesUseCase ────────────────────────────────────────

describe("SynchronizeNumberingRangesUseCase", () => {
  class FakeRangePort implements NumberingRangePort {
    constructor(private readonly outcome: NumberingRangeOutcome) {}
    synchronizeRanges(_query: NumberingRangeQuery, _signal: AbortSignal): Promise<NumberingRangeOutcome> {
      return Promise.resolve(this.outcome);
    }
  }

  it("persiste lo que el puerto sincroniza", async () => {
    const database = await openDatabase();
    const documentStore = new SqliteFiscalDocumentStore(database, () => NOW);
    const port = new FakeRangePort({
      kind: "SYNCHRONIZED",
      ranges: [{
        rangeId: RANGE_ID, documentType: DOCUMENT_TYPE, prefix: "SETP", authority: "PROVIDER",
        resolutionNumber: "1", rangeFrom: 1, rangeTo: 5000, currentNumber: 0,
        validFrom: null, validUntil: null, providerActive: true, providerExpired: false, providerDocumentCode: "01",
      }],
    });
    const useCase = new SynchronizeNumberingRangesUseCase(port, documentStore, () => NOW);
    const result = await useCase.execute(SCOPE, PROVIDER, ENVIRONMENT, [DOCUMENT_TYPE], CREDENTIAL, SIGNAL);
    expect(result).toEqual({ kind: "SYNCHRONIZED", count: 1 });
    expect(documentStore.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO).kind).toBe("FOUND");
  });

  it("propaga UNAVAILABLE sin escribir nada", async () => {
    const database = await openDatabase();
    const documentStore = new SqliteFiscalDocumentStore(database, () => NOW);
    const port = new FakeRangePort({ kind: "UNAVAILABLE", reasonCode: "NETWORK" });
    const useCase = new SynchronizeNumberingRangesUseCase(port, documentStore, () => NOW);
    const result = await useCase.execute(SCOPE, PROVIDER, ENVIRONMENT, [DOCUMENT_TYPE], CREDENTIAL, SIGNAL);
    expect(result).toEqual({ kind: "UNAVAILABLE", reasonCode: "NETWORK" });
    expect(documentStore.selectRange(SCOPE, PROVIDER, ENVIRONMENT, DOCUMENT_TYPE, NOW_ISO)).toEqual({ kind: "NOT_SYNCHRONIZED" });
  });

  it("deduplica por rangeId cuando dos tipos documentales devuelven el mismo rango", async () => {
    const database = await openDatabase();
    const documentStore = new SqliteFiscalDocumentStore(database, () => NOW);
    const shared = {
      rangeId: RANGE_ID, documentType: DOCUMENT_TYPE, prefix: "SETP", authority: "PROVIDER" as const,
      resolutionNumber: "1", rangeFrom: 1, rangeTo: 5000, currentNumber: 0,
      validFrom: null, validUntil: null, providerActive: true, providerExpired: false, providerDocumentCode: "01",
    };
    const port = new FakeRangePort({ kind: "SYNCHRONIZED", ranges: [shared] });
    const useCase = new SynchronizeNumberingRangesUseCase(port, documentStore, () => NOW);
    const result = await useCase.execute(SCOPE, PROVIDER, ENVIRONMENT, [DOCUMENT_TYPE, DOCUMENT_TYPE], CREDENTIAL, SIGNAL);
    expect(result).toEqual({ kind: "SYNCHRONIZED", count: 1 });
  });
});

// ── IssueElectronicDocumentUseCase ───────────────────────────────────────────

describe("IssueElectronicDocumentUseCase — camino feliz", () => {
  it("EVIDENCED → ISSUED, con cufe y consecutivo persistidos", async () => {
    const port = new FakeIssuancePort(evidenced());
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const result = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(result.kind).toBe("ISSUED");
    if (result.kind !== "ISSUED") return;
    expect(result.document.transportStatus).toBe("COMPLETED");
    expect(result.document.normalizedResult).toBe("ACCEPTED");
    expect(result.document.cufe).toBe("a".repeat(96));
    expect(result.document.issuedNumber).toBe("990000001");
    expect(port.callCount).toBe(1);
  });
});

describe("IssueElectronicDocumentUseCase — permiso (F5, cruce del canal)", () => {
  it("sin FISCAL_DOCUMENT_ISSUE: UNAUTHORIZED, y no se toca nada", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const result = await useCase.execute(auth([]), baseInput(saleId), SIGNAL);
    expect(result.kind).toBe("UNAUTHORIZED");
    expect(port.callCount).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM fiscal_electronic_document").get() as { n: number }).n).toBe(0);
  });
});

describe("IssueElectronicDocumentUseCase — rechazo fiscal persistido", () => {
  it("never labels a provider rejection as issued, including subsequent reads", async () => {
    const port = new FakeIssuancePort(evidenced({ normalizedResult: "REJECTED", externalIdentity: {providerOperationId:"rejected-operation",providerDocumentId:null,prefix:null,number:null,cufe:null} }));
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");
    const first = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(first.kind).toBe("FISCAL_REJECTED");
    const again = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(again.kind).toBe("FISCAL_REJECTED");
    expect(port.callCount).toBe(1);
    expect(database.native.prepare("SELECT transport_status, normalized_result FROM fiscal_electronic_document").get()).toMatchObject({transport_status:"COMPLETED",normalized_result:"REJECTED"});
  });
});

describe("IssueElectronicDocumentUseCase — idempotencia (regla 3)", () => {
  it("un documento ya COMPLETED se resuelve como ALREADY_ISSUED sin volver a transmitir", async () => {
    const port = new FakeIssuancePort(evidenced());
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const first = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(first.kind).toBe("ISSUED");
    expect(port.callCount).toBe(1);

    const second = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(second.kind).toBe("ALREADY_ISSUED");
    // La prueba que importa: el puerto no se volvió a llamar.
    expect(port.callCount).toBe(1);
  });
});

describe("IssueElectronicDocumentUseCase — desenlace incierto (regla 5 y 6)", () => {
  it("UNCERTAIN se persiste como UNKNOWN_OUTCOME y exige conciliación, nunca reintento automático", async () => {
    const port = new FakeIssuancePort(uncertain());
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const first = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(first.kind).toBe("UNCERTAIN");
    if (first.kind === "UNCERTAIN") expect(first.document.transportStatus).toBe("UNKNOWN_OUTCOME");
    expect(port.callCount).toBe(1);

    const second = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(second.kind).toBe("REQUIRES_RECONCILIATION");
    // La prueba que importa: nunca se transmite una segunda vez sin conciliar.
    expect(port.callCount).toBe(1);
  });
});

describe("IssueElectronicDocumentUseCase — fallo técnico es retriable", () => {
  it("TECHNICAL_FAILURE → TRANSPORT_FAILED, y el reintento reusa el mismo payload congelado", async () => {
    const port = new FakeIssuancePort(technicalFailure(), evidenced());
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const first = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(first.kind).toBe("TRANSPORT_FAILED");
    if (first.kind !== "TRANSPORT_FAILED") return;
    expect(first.document.attemptCount).toBe(1);

    const second = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(second.kind).toBe("ISSUED");
    if (second.kind !== "ISSUED") return;
    expect(second.document.attemptCount).toBe(2);
    // Regla 8: misma identidad, mismo payload — no se volvió a ensamblar.
    expect(second.document.payloadChecksum).toBe(first.document.payloadChecksum);
    expect(second.document.idempotencyKey).toBe(first.document.idempotencyKey);
    expect(port.callCount).toBe(2);
  });
});

describe("IssueElectronicDocumentUseCase — elegibilidad", () => {
  it("una venta que no existe en el alcance es NOT_ELIGIBLE", async () => {
    const port = new FakeIssuancePort();
    const { useCase } = await buildEnv(port);
    const result = await useCase.execute(auth(), baseInput(randomUUID()), SIGNAL);
    expect(result).toEqual({ kind: "NOT_ELIGIBLE" });
    expect(port.callCount).toBe(0);
  });

  it("una venta que existe pero no está COMPLETED es NOT_ELIGIBLE", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    const saleId = seedSale(database);
    database.native.prepare("UPDATE sales_sales SET status='READY_FOR_PAYMENT', completed_at=NULL WHERE id=?").run(saleId);
    const result = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(result).toEqual({ kind: "NOT_ELIGIBLE" });
  });
});

describe("IssueElectronicDocumentUseCase — bloqueos, sin crear ningún documento", () => {
  it("sin rango sincronizado: BLOCKED NUMBERING_RANGE_NOT_SYNCHRONIZED", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const result = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(result).toEqual({ kind: "BLOCKED", code: "NUMBERING_RANGE_NOT_SYNCHRONIZED" });
    expect(port.callCount).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM fiscal_electronic_document").get() as { n: number }).n).toBe(0);
  });

  it("con rango expirado: BLOCKED NUMBERING_RANGE_NOT_VALID", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    seedRange(database, { provider_expired: 1, provider_active: 0 });
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const result = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(result).toEqual({ kind: "BLOCKED", code: "NUMBERING_RANGE_NOT_VALID" });
  });

  it("presentación sin atributo fiscal: BLOCKED con LINE_FISCAL_ATTRIBUTE_MISSING", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1, { withFiscalAttribute: false });
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const result = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(result.kind).toBe("BLOCKED");
    if (result.kind !== "BLOCKED") return;
    expect(result.code).toBe("PAYLOAD_ASSEMBLY_BLOCKED");
    expect(result.reasons?.some((reason) => reason.code === "LINE_FISCAL_ATTRIBUTE_MISSING")).toBe(true);
    expect(port.callCount).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM fiscal_electronic_document").get() as { n: number }).n).toBe(0);
  });

  it("adquiriente anónimo (D-13): BLOCKED con GENERIC_ACQUIRER_NOT_VERIFIED — el tercero genérico DIAN no está verificado en este repositorio", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    const result = await useCase.execute(auth(), baseInput(saleId, { customer: ANONYMOUS_CUSTOMER }), SIGNAL);
    expect(result.kind).toBe("BLOCKED");
    if (result.kind !== "BLOCKED") return;
    expect(result.code).toBe("PAYLOAD_ASSEMBLY_BLOCKED");
    expect(result.reasons?.some((reason) => reason.code === "GENERIC_ACQUIRER_NOT_VERIFIED")).toBe(true);
    expect(port.callCount).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM fiscal_electronic_document").get() as { n: number }).n).toBe(0);
  });

  it("método de pago sin código DIAN verificado (CARD): BLOCKED PAYMENT_METHOD_CODE_NOT_VERIFIED", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CARD", "10000.000000");

    const result = await useCase.execute(auth(), baseInput(saleId), SIGNAL);
    expect(result.kind).toBe("BLOCKED");
    if (result.kind !== "BLOCKED") return;
    expect(result.code).toBe("PAYMENT_METHOD_CODE_NOT_VERIFIED:0");
    expect(port.callCount).toBe(0);
    expect((database.native.prepare("SELECT count(*) AS n FROM fiscal_electronic_document").get() as { n: number }).n).toBe(0);
  });

  it("tipo documental sin código DIAN verificado: BLOCKED DOCUMENT_TYPE_CODE_NOT_VERIFIED", async () => {
    const port = new FakeIssuancePort();
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleId = seedSale(database);
    seedCatalogLine(database, saleId, 1);
    seedConfirmedPayment(database, saleId, "CASH", "10000.000000");

    // CREDIT_NOTE existe en el contrato canónico pero su código DIAN no está
    // verificado (`dian/codes.ts`): F4 debe bloquear, no inventar el código.
    const result = await useCase.execute(auth(), baseInput(saleId, { documentType: "CREDIT_NOTE" }), SIGNAL);
    expect(result).toEqual({ kind: "BLOCKED", code: "DOCUMENT_TYPE_CODE_NOT_VERIFIED" });
    expect(port.callCount).toBe(0);
  });
});

describe("IssueElectronicDocumentUseCase — dos ventas no colisionan", () => {
  it("cada venta obtiene su propia identidad e idempotency key", async () => {
    const port = new FakeIssuancePort(evidenced({ externalIdentity: {
      providerOperationId: "op-1", providerDocumentId: "doc-1", prefix: "SETP", number: "990000001", cufe: "a".repeat(96),
    } }), evidenced({ externalIdentity: {
      providerOperationId: "op-2", providerDocumentId: "doc-2", prefix: "SETP", number: "990000002", cufe: "b".repeat(96),
    } }));
    const { database, useCase } = await buildEnv(port);
    seedRange(database);
    const saleA = seedSale(database);
    seedCatalogLine(database, saleA, 1);
    seedConfirmedPayment(database, saleA, "CASH", "10000.000000");
    const saleB = seedSale(database);
    seedCatalogLine(database, saleB, 1);
    seedConfirmedPayment(database, saleB, "CASH", "10000.000000");

    const resultA = await useCase.execute(auth(), baseInput(saleA), SIGNAL);
    const resultB = await useCase.execute(auth(), baseInput(saleB), SIGNAL);
    expect(resultA.kind).toBe("ISSUED");
    expect(resultB.kind).toBe("ISSUED");
    if (resultA.kind !== "ISSUED" || resultB.kind !== "ISSUED") return;
    expect(resultA.document.idempotencyKey).not.toBe(resultB.document.idempotencyKey);
    expect(resultA.document.cufe).not.toBe(resultB.document.cufe);
    expect((database.native.prepare("SELECT count(*) AS n FROM fiscal_electronic_document").get() as { n: number }).n).toBe(2);
  });
});
