/**
 * Gate excepcional FACTUS + FACTUS Pay — sólo sandbox, sólo con autorización
 * explícita del propietario. No forma parte del CI ordinario ni de PRs.
 *
 * Requisitos:
 *   CAMACHO_FACTUS_SANDBOX_EXCEPTIONAL=OWNER_AUTHORIZED_SANDBOX_ONLY
 *   FACTUS_SANDBOX_CLIENT_ID / _SECRET / _USERNAME / _PASSWORD
 *   FACTUS_PAY_SANDBOX_EMAIL / _PASSWORD
 *
 * No imprime secretos, tokens, cabeceras ni cuerpos sensibles.
 * No declara SANDBOX_VERIFIED: emite resultados OBSERVED por paso.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FactusAdapter,
  FetchHttpTransport,
  FACTUS_SANDBOX_ENV,
  authorizesIssuance,
  type CredentialReference,
  type FactusCredential,
  type FactusCredentialResolver,
  type NumberingRangeSnapshot,
} from "@pos-platform/fiscal-adapters";
import { EncryptedFileSecretStore } from "../../apps/pos-local-service/src/security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../../apps/pos-local-service/src/security/insecure-derived-key-provider.js";
import { FactusPayCredentialStore } from "../../apps/pos-local-service/src/payments/factus-pay-credential-store.js";
import { FactusPayClient } from "../../apps/pos-local-service/src/payments/factus-pay-client.js";

const AUTHORIZATION = "OWNER_AUTHORIZED_SANDBOX_ONLY";
const FACTUS_SANDBOX_ORIGIN = "https://api-sandbox.factus.com.co";
const FACTUS_PAY_SANDBOX_ORIGIN = "https://pay-api-sandbox.factus.com.co";
const OFFICIAL_PAY_SIMULATOR = "https://pay-api-sandbox.factus.com.co/simulator";

type StepStatus = "OBSERVED_PASS" | "OBSERVED_FAIL" | "BLOCKED" | "NOT_RUN" | "NOT_AVAILABLE";

interface StepResult {
  readonly provider: "FACTUS" | "FACTUS_PAY";
  readonly step: string;
  readonly status: StepStatus;
  readonly detail: string;
}

const steps: StepResult[] = [];
let failed = false;

function record(provider: StepResult["provider"], step: string, status: StepStatus, detail: string): void {
  steps.push({ provider, step, status, detail });
  const line = `[${provider}] ${step}: ${status} — ${detail}`;
  if (status === "OBSERVED_FAIL" || status === "BLOCKED") {
    failed = true;
    console.error(line);
  } else {
    console.log(line);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`MISSING_ENV:${name}`);
  }
  return value;
}

function redact(value: string): string {
  if (value.length <= 8) return `len=${value.length}`;
  return `len=${value.length};prefix=${value.slice(0, 4)}…`;
}

class EnvCredentialResolver implements FactusCredentialResolver {
  constructor(private readonly value: FactusCredential) {}
  async resolve(_reference: CredentialReference): Promise<FactusCredential> {
    return this.value;
  }
}

const REFERENCE: CredentialReference = { secretRef: "env:factus:sandbox:exceptional", version: "1" };

function pickActiveRange(
  ranges: readonly NumberingRangeSnapshot[],
  documentType: "SALES_INVOICE" | "CREDIT_NOTE",
): NumberingRangeSnapshot | null {
  const matching = ranges.filter((range) => {
    if (range.documentType !== documentType) return false;
    if (range.rangeId.startsWith("derived:")) return false;
    if (range.providerExpired === true) return false;
    if (range.providerActive === false) return false;
    return true;
  });
  return matching[0] ?? null;
}

function buildBillPayload(rangeId: string, referenceCode: string): Record<string, unknown> {
  const numericRange = Number(rangeId);
  return {
    reference_code: referenceCode,
    document: "01",
    numbering_range_id: Number.isFinite(numericRange) ? numericRange : rangeId,
    operation_type: "10",
    observation: "Camacho POS exceptional sandbox gate",
    cash_rounding_amount: "0.00",
    payment_details: [{
      payment_form: "1",
      payment_method_code: "10",
      amount: "1190.00",
      due_date: null,
    }],
    customer: {
      identification_document_code: "13",
      identification: "1020304050",
      dv: null,
      legal_organization_code: "2",
      company: null,
      names: "Ana Restrepo Sandbox",
      tribute_code: "ZZ",
      responsibilities: ["R-99-PN"],
      address: "Calle 1 # 2-3",
      email: "sandbox-customer@example.invalid",
      phone: "3001234567",
      country_code: "CO",
      municipality_code: "05001",
    },
    items: [{
      code_reference: "SANDBOX-ITEM-1",
      name: "Producto sandbox Camacho",
      quantity: "1.00",
      price: "1000.00",
      unit_measure_code: "94",
      standard_code: "999",
      taxes: [{ code: "01", rate: "19.00" }],
    }],
  };
}

function buildCreditNotePayload(
  rangeId: string,
  referenceCode: string,
  billNumber: string,
): Record<string, unknown> {
  const numericRange = Number(rangeId);
  return {
    reference_code: referenceCode,
    correction_concept_code: "2",
    customization_id: "20",
    bill_number: billNumber,
    numbering_range_id: Number.isFinite(numericRange) ? numericRange : rangeId,
    observation: "Camacho POS exceptional sandbox credit note",
    payment_details: [{
      payment_form: "1",
      payment_method_code: "10",
      amount: "1190.00",
    }],
    customer: {
      identification_document_code: "13",
      identification: "1020304050",
      dv: null,
      legal_organization_code: "2",
      company: null,
      names: "Ana Restrepo Sandbox",
      tribute_code: "ZZ",
      responsibilities: ["R-99-PN"],
      address: "Calle 1 # 2-3",
      email: "sandbox-customer@example.invalid",
      phone: "3001234567",
      country_code: "CO",
      municipality_code: "05001",
    },
    items: [{
      code_reference: "SANDBOX-ITEM-1",
      name: "Producto sandbox Camacho",
      quantity: "1.00",
      price: "1000.00",
      unit_measure_code: "94",
      standard_code: "999",
      taxes: [{ code: "01", rate: "19.00" }],
    }],
  };
}

async function runFactus(credential: FactusCredential, signal: AbortSignal): Promise<void> {
  const adapter = new FactusAdapter(
    new FetchHttpTransport(),
    new EnvCredentialResolver(credential),
    "SANDBOX",
    { now: () => Date.now() },
  );

  try {
    const config = await adapter.validateConfiguration({
      environment: "SANDBOX",
      credential: REFERENCE,
      expectedCredentialShape: {
        transport: "OAUTH2_PASSWORD_GRANT",
        tokenLifecycle: "ACCESS_AND_REFRESH_TOKEN",
        fields: [
          { name: "client_id", source: "CUSTOMER", secret: false },
          { name: "client_secret", source: "CUSTOMER", secret: true },
          { name: "username", source: "CUSTOMER", secret: false },
          { name: "password", source: "CUSTOMER", secret: true },
        ],
        neverAccountPassword: false,
      },
    }, signal);
    if (config.kind === "VALID" && authorizesIssuance(config)) {
      record("FACTUS", "authentication_and_configuration", "OBSERVED_PASS", "validateConfiguration=VALID");
    } else {
      record("FACTUS", "authentication_and_configuration", "OBSERVED_FAIL", `kind=${config.kind}`);
      return;
    }

    const invoiceRanges = await adapter.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: REFERENCE },
      signal,
    );
    if (invoiceRanges.kind !== "SYNCHRONIZED") {
      record("FACTUS", "numbering_sync_invoice", "OBSERVED_FAIL", `${invoiceRanges.kind}:${invoiceRanges.reasonCode}`);
      return;
    }
    const invoiceRange = pickActiveRange(invoiceRanges.ranges, "SALES_INVOICE");
    if (invoiceRange === null) {
      record("FACTUS", "numbering_sync_invoice", "BLOCKED", "no active PROVIDER invoice range with FACTUS id");
      return;
    }
    record(
      "FACTUS",
      "numbering_sync_invoice",
      "OBSERVED_PASS",
      `ranges=${invoiceRanges.ranges.length};selected_prefix=${invoiceRange.prefix};authority=${invoiceRange.authority}`,
    );

    const creditRanges = await adapter.synchronizeRanges(
      { documentType: "CREDIT_NOTE", environment: "SANDBOX", credential: REFERENCE },
      signal,
    );
    let creditRange: NumberingRangeSnapshot | null = null;
    if (creditRanges.kind !== "SYNCHRONIZED") {
      record("FACTUS", "numbering_sync_credit_note", "OBSERVED_FAIL", `${creditRanges.kind}:${creditRanges.reasonCode}`);
    } else {
      creditRange = pickActiveRange(creditRanges.ranges, "CREDIT_NOTE");
      if (creditRange === null) {
        record("FACTUS", "numbering_sync_credit_note", "BLOCKED", "no active PROVIDER credit-note range with FACTUS id");
      } else {
        record(
          "FACTUS",
          "numbering_sync_credit_note",
          "OBSERVED_PASS",
          `ranges=${creditRanges.ranges.length};selected_prefix=${creditRange.prefix}`,
        );
      }
    }

    const referenceCode = `CAMACHO-SBX-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const payload = buildBillPayload(invoiceRange.rangeId, referenceCode);
    const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const issuance = await adapter.issue({
      electronicDocumentId: randomUUID(),
      idempotencyKey: referenceCode,
      attemptNumber: 1,
      environment: "SANDBOX",
      credential: REFERENCE,
      document: {
        documentType: "SALES_INVOICE",
        payload,
        checksumSha256: checksum,
      },
    }, signal);

    if (issuance.kind !== "EVIDENCED" || issuance.normalizedResult !== "ACCEPTED") {
      const diagnostic = "diagnostic" in issuance
        ? String((issuance as { diagnostic?: { code?: string } }).diagnostic?.code ?? issuance.kind)
        : issuance.kind;
      record("FACTUS", "document_issuance", "OBSERVED_FAIL", `kind=${issuance.kind};detail=${diagnostic}`);
      record("FACTUS", "document_status_query", "NOT_RUN", "issuance did not evidence ACCEPTED");
      record("FACTUS", "artifact_pdf", "NOT_RUN", "no accepted document");
      record("FACTUS", "artifact_xml", "NOT_RUN", "no accepted document");
      record("FACTUS", "credit_note_issuance", "NOT_RUN", "no accepted invoice");
      return;
    }

    const providerOperationId = issuance.externalIdentity.providerOperationId;
    const billNumber = issuance.externalIdentity.number;
    record(
      "FACTUS",
      "document_issuance",
      "OBSERVED_PASS",
      `normalized=ACCEPTED;has_cufe=${issuance.externalIdentity.cufe !== null};has_number=${billNumber !== null}`,
    );

    const status = await adapter.queryStatus({
      environment: "SANDBOX",
      credential: REFERENCE,
      reference: { by: "EXTERNAL", providerOperationId },
    }, signal);
    if (status.kind === "FOUND") {
      record("FACTUS", "document_status_query", "OBSERVED_PASS", `normalized=${status.normalizedResult}`);
    } else {
      record("FACTUS", "document_status_query", "OBSERVED_FAIL", `kind=${status.kind}`);
    }

    for (const artifactType of ["PDF", "XML"] as const) {
      const artifact = await adapter.fetchArtifact({
        electronicDocumentId: randomUUID(),
        providerOperationId,
        artifactType,
        environment: "SANDBOX",
        credential: REFERENCE,
      }, signal);
      const step = artifactType === "PDF" ? "artifact_pdf" : "artifact_xml";
      if (artifact.kind === "RETRIEVED") {
        record(
          "FACTUS",
          step,
          "OBSERVED_PASS",
          `bytes=${artifact.artifact.byteLength};sha256=${artifact.artifact.checksumSha256.slice(0, 12)}…;media=${artifact.artifact.mediaType}`,
        );
      } else {
        const reason = artifact.kind === "UNAVAILABLE" ? artifact.reasonCode : artifact.kind;
        record("FACTUS", step, "OBSERVED_FAIL", `kind=${artifact.kind};reason=${reason}`);
      }
    }

    if (creditRange === null || billNumber === null) {
      record(
        "FACTUS",
        "credit_note_issuance",
        "BLOCKED",
        creditRange === null ? "missing credit-note range" : "invoice number absent",
      );
      return;
    }

    const cnReference = `CAMACHO-CN-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const cnPayload = buildCreditNotePayload(creditRange.rangeId, cnReference, billNumber);
    const cnChecksum = createHash("sha256").update(JSON.stringify(cnPayload)).digest("hex");
    const creditNote = await adapter.issue({
      electronicDocumentId: randomUUID(),
      idempotencyKey: cnReference,
      attemptNumber: 1,
      environment: "SANDBOX",
      credential: REFERENCE,
      document: {
        documentType: "CREDIT_NOTE",
        payload: cnPayload,
        checksumSha256: cnChecksum,
      },
    }, signal);
    if (creditNote.kind === "EVIDENCED") {
      record(
        "FACTUS",
        "credit_note_issuance",
        "OBSERVED_PASS",
        `normalized=${creditNote.normalizedResult};has_number=${creditNote.externalIdentity.number !== null}`,
      );
    } else {
      const diagnostic = "diagnostic" in creditNote
        ? String((creditNote as { diagnostic?: { code?: string } }).diagnostic?.code ?? creditNote.kind)
        : creditNote.kind;
      record("FACTUS", "credit_note_issuance", "OBSERVED_FAIL", `kind=${creditNote.kind};detail=${diagnostic}`);
    }
  } finally {
    adapter.close();
  }
}

async function runFactusPay(signal: AbortSignal): Promise<void> {
  const email = requireEnv("FACTUS_PAY_SANDBOX_EMAIL");
  const password = requireEnv("FACTUS_PAY_SANDBOX_PASSWORD");
  const companyId = "018f0000-0000-7000-8000-00000000sb01";
  const installationId = "018f0000-0000-7000-8000-00000000sb02";
  const deviceId = "018f0000-0000-7000-8000-00000000sb03";
  const dir = mkdtempSync(join(tmpdir(), "factus-pay-sandbox-gate-"));
  const secrets = new EncryptedFileSecretStore(
    dir,
    new InsecureDerivedKeyProvider(dir),
    `factus-pay-sandbox-gate:${installationId}:${deviceId}:${companyId}`,
  );
  const store = new FactusPayCredentialStore(secrets, companyId);
  store.deposit({ environment: "SANDBOX", email, password });
  const client = new FactusPayClient(store, "SANDBOX", () => new Date(), fetch);

  try {
    const referenceCode = `PAY-SBX-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const amountScale6 = "150000.000000";
    const created = await client.createCollection({
      referenceCode,
      amountScale6,
      expirationSeconds: 900,
      signal,
    });
    record(
      "FACTUS_PAY",
      "authentication_and_collection_create",
      "OBSERVED_PASS",
      `status=${created.status};has_qr=${created.qr !== null};qr_redacted=${created.qr === null ? "none" : redact(created.qr)};reference_redacted=${redact(referenceCode)}`,
    );

    const queried = await client.getCollection({
      referenceCode,
      expectedAmountScale6: amountScale6,
      signal,
    });
    record(
      "FACTUS_PAY",
      "collection_status_query",
      "OBSERVED_PASS",
      `status=${queried.status};currency=${queried.currencyCode}`,
    );

    // Conciliación = correlación referencia/importe/estado vía GET oficial.
    if (queried.referenceCode === referenceCode && queried.amountScale6 === amountScale6) {
      record(
        "FACTUS_PAY",
        "reconciliation_get",
        "OBSERVED_PASS",
        `matched_reference_and_amount;status=${queried.status}`,
      );
    } else {
      record("FACTUS_PAY", "reconciliation_get", "OBSERVED_FAIL", "reference_or_amount_mismatch");
    }

    // El simulador oficial es UI (cámara/QR), no API headless.
    let simulatorReachable = false;
    try {
      const probe = await fetch(OFFICIAL_PAY_SIMULATOR, {
        method: "GET",
        redirect: "manual",
        signal,
      });
      simulatorReachable = probe.status > 0 && probe.status < 500;
    } catch {
      simulatorReachable = false;
    }
    record(
      "FACTUS_PAY",
      "official_payment_simulation",
      "NOT_AVAILABLE",
      simulatorReachable
        ? `official_simulator_is_ui_only;reachable=true;url=${OFFICIAL_PAY_SIMULATOR};no_headless_api;payment_not_forced`
        : `official_simulator_unreachable_or_ui_only;url=${OFFICIAL_PAY_SIMULATOR};payment_not_forced`,
    );
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as { code: unknown }).code)
      : error instanceof Error ? error.message : "UNKNOWN";
    record("FACTUS_PAY", "authentication_and_collection_create", "OBSERVED_FAIL", `error_code=${code}`);
    record("FACTUS_PAY", "collection_status_query", "NOT_RUN", "create failed");
    record("FACTUS_PAY", "reconciliation_get", "NOT_RUN", "create failed");
    record("FACTUS_PAY", "official_payment_simulation", "NOT_RUN", "create failed");
  } finally {
    secrets.destroy();
  }
}

async function main(): Promise<void> {
  if (process.env.CAMACHO_FACTUS_SANDBOX_EXCEPTIONAL !== AUTHORIZATION) {
    console.error(`REFUSED: set CAMACHO_FACTUS_SANDBOX_EXCEPTIONAL=${AUTHORIZATION}`);
    process.exit(2);
  }

  // Guardas de origen: este gate nunca habla con producción.
  if (!FACTUS_SANDBOX_ORIGIN.includes("sandbox") || !FACTUS_PAY_SANDBOX_ORIGIN.includes("sandbox")) {
    console.error("REFUSED: sandbox origin invariant broken");
    process.exit(2);
  }

  const credential: FactusCredential = {
    clientId: requireEnv(FACTUS_SANDBOX_ENV.clientId),
    clientSecret: requireEnv(FACTUS_SANDBOX_ENV.clientSecret),
    username: requireEnv(FACTUS_SANDBOX_ENV.username),
    password: requireEnv(FACTUS_SANDBOX_ENV.password),
  };
  requireEnv("FACTUS_PAY_SANDBOX_EMAIL");
  requireEnv("FACTUS_PAY_SANDBOX_PASSWORD");

  console.log("FACTUS exceptional sandbox gate starting (redacted evidence only)");
  console.log(`factus_origin=${FACTUS_SANDBOX_ORIGIN}`);
  console.log(`factus_pay_origin=${FACTUS_PAY_SANDBOX_ORIGIN}`);
  console.log(`commit=${process.env.REVIEWED_SHA ?? process.env.GITHUB_SHA ?? "local"}`);
  console.log(`claim_level=OBSERVED_ONLY (does not promote SANDBOX_VERIFIED)`);

  const signal = AbortSignal.timeout(120_000);
  await runFactus(credential, signal);
  await runFactusPay(signal);

  const byProvider = {
    FACTUS: steps.filter((s) => s.provider === "FACTUS"),
    FACTUS_PAY: steps.filter((s) => s.provider === "FACTUS_PAY"),
  };
  const evidence = {
    gate: "factus-sandbox-exceptional",
    authorization: AUTHORIZATION,
    claim_level: "OBSERVED_ONLY",
    sandbox_verified_declared: false,
    origins: {
      factus: FACTUS_SANDBOX_ORIGIN,
      factus_pay: FACTUS_PAY_SANDBOX_ORIGIN,
      factus_pay_simulator: OFFICIAL_PAY_SIMULATOR,
    },
    commit: process.env.REVIEWED_SHA ?? process.env.GITHUB_SHA ?? null,
    generated_at: new Date().toISOString(),
    steps,
    by_provider: byProvider,
  };

  const outDir = process.env.CAMACHO_SANDBOX_EVIDENCE_DIR
    ?? join(process.cwd(), "artifacts", "factus-sandbox-exceptional");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `evidence-${Date.now()}.json`);
  writeFileSync(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`evidence_path=${outFile}`);
  console.log(JSON.stringify({
    summary: steps.map((s) => ({ provider: s.provider, step: s.step, status: s.status })),
    sandbox_verified_declared: false,
  }));

  if (failed) process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  console.error(`GATE_CRASH:${message}`);
  process.exit(1);
});
