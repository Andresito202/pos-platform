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
  selectRangesForDocumentType,
  type CredentialReference,
  type FactusCredential,
  type FactusCredentialResolver,
  type NumberingRangeSnapshot,
} from "../../packages/fiscal-adapters/src/index.js";
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
  // GitHub secret paste often keeps trailing newlines/spaces; FACTUS OAuth
  // rejects them as CREDENTIAL_REJECTED → validateConfiguration INCOMPLETE.
  return value.trim();
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
  const { matching } = selectRangesForDocumentType(ranges, documentType);
  const candidates = matching.filter((range) =>
    range.documentType === documentType &&
    range.authority === "PROVIDER" &&
    /^[1-9]\d*$/.test(range.rangeId) && Number.isSafeInteger(Number(range.rangeId)) &&
    range.providerActive === true && range.providerExpired === false);
  // Sólo para el gate sandbox: determinismo independiente del orden API.
  return candidates.sort((left, right) => Number(left.rangeId) - Number(right.rangeId))[0] ?? null;
}

// Mismo contrato que la factura y NC validadas manualmente el 2026-11-18.
// Sin cliente real ni envío de correo; el rango se resuelve, nunca se fija.
function sandboxCustomer(): Record<string, unknown> {
  return {
    identification_document_code: "13", identification: "222222222222",
    names: "Consumidor final", legal_organization_code: "2", tribute_code: "ZZ",
    country_code: "CO", municipality_code: "11001", responsibilities: ["R-99-PN"],
  };
}

function sandboxItems(): readonly Record<string, unknown>[] {
  return [{
    code_reference: "TEST001", name: "Producto de prueba", quantity: "1.00",
    discount_rate: "0.00", price: "10000.00", unit_measure_code: "94",
    standard_code: "999", taxes: [{ code: "01", rate: "19.00" }],
  }];
}

function sandboxPayments(): readonly Record<string, unknown>[] {
  return [{ payment_form: "1", payment_method_code: "10", amount: "11900.00" }];
}

function buildBillPayload(rangeId: string, referenceCode: string): Record<string, unknown> {
  return {
    reference_code: referenceCode, document: "01", numbering_range_id: Number(rangeId),
    operation_type: "10", observation: "Camacho POS exceptional sandbox gate", send_email: false,
    payment_details: sandboxPayments(), customer: sandboxCustomer(), items: sandboxItems(),
  };
}

function buildCreditNotePayload(rangeId: string, referenceCode: string, billNumber: string): Record<string, unknown> {
  return {
    reference_code: referenceCode, correction_concept_code: "2", customization_id: "20",
    bill_number: billNumber, numbering_range_id: Number(rangeId),
    observation: "Camacho POS exceptional sandbox credit note", send_email: false,
    payment_details: sandboxPayments(), customer: sandboxCustomer(), items: sandboxItems(),
  };
}

/**
 * Compara la forma Postman oficial (multipart form-data) con la del adapter
 * (application/x-www-form-urlencoded, alineada al ejemplo Node/Laravel asForm
 * de developers.factus.com.co). Sólo registra HTTP status + oauth_error seguro.
 */
async function probeFactusOAuthEncodings(
  credential: FactusCredential,
  signal: AbortSignal,
): Promise<void> {
  const url = `${FACTUS_SANDBOX_ORIGIN}/oauth/token`;
  const fields: ReadonlyArray<readonly [string, string]> = [
    ["grant_type", "password"],
    ["client_id", credential.clientId],
    ["client_secret", credential.clientSecret],
    ["username", credential.username],
    ["password", credential.password],
  ];

  async function one(
    encoding: "urlencoded_adapter" | "multipart_postman",
  ): Promise<{ status: number; oauth_error: string | null }> {
    let response: Response;
    if (encoding === "urlencoded_adapter") {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields).toString(),
        signal,
      });
    } else {
      const form = new FormData();
      for (const [key, value] of fields) form.append(key, value);
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: { Accept: "application/json" },
        body: form,
        signal,
      });
    }
    const text = await response.text();
    let oauthError: string | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string") {
        const normalized = parsed.error.trim().toLowerCase();
        const safe = new Set([
          "invalid_request",
          "invalid_client",
          "invalid_grant",
          "unauthorized_client",
          "unsupported_grant_type",
          "invalid_scope",
        ]);
        oauthError = safe.has(normalized) ? normalized : null;
      }
    } catch {
      oauthError = null;
    }
    return { status: response.status, oauth_error: oauthError };
  }

  const urlencoded = await one("urlencoded_adapter");
  const multipart = await one("multipart_postman");
  record(
    "FACTUS",
    "oauth_encoding_probe",
    urlencoded.status === 200 || multipart.status === 200 ? "OBSERVED_PASS" : "OBSERVED_FAIL",
    [
      "postman_collection=formdata;adapter=urlencoded;docs_node_php=urlencoded",
      `urlencoded_http=${urlencoded.status};urlencoded_oauth_error=${urlencoded.oauth_error ?? "none"}`,
      `multipart_http=${multipart.status};multipart_oauth_error=${multipart.oauth_error ?? "none"}`,
      `encodings_agree=${urlencoded.status === multipart.status && urlencoded.oauth_error === multipart.oauth_error}`,
      "params=grant_type,client_id,client_secret,username,password",
      "endpoint=/oauth/token",
    ].join(";"),
  );
}

async function runFactus(credential: FactusCredential, signal: AbortSignal): Promise<void> {
  await probeFactusOAuthEncodings(credential, signal);

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
      const findings = "findings" in config && Array.isArray(config.findings)
        ? config.findings.map((finding) => {
          const code = typeof finding === "object" && finding !== null && "code" in finding
            ? String(finding.code)
            : "UNKNOWN";
          const field = typeof finding === "object" && finding !== null && "fieldName" in finding && finding.fieldName
            ? `;field=${String(finding.fieldName)}`
            : "";
          const diagnostic = typeof finding === "object" && finding !== null && "diagnosticReference" in finding && finding.diagnosticReference
            ? `;diag=${String(finding.diagnosticReference)}`
            : "";
          return `${code}${field}${diagnostic}`;
        }).join("|")
        : "no_findings";
      const reason = "reasonCode" in config && config.reasonCode ? `;reason=${String(config.reasonCode)}` : "";
      record(
        "FACTUS",
        "authentication_and_configuration",
        "OBSERVED_FAIL",
        `kind=${config.kind}${reason};findings=${findings}`,
      );
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

    if (issuance.kind !== "EVIDENCED" || issuance.normalizedResult !== "ACCEPTED" ||
        !issuance.externalIdentity.number || !issuance.externalIdentity.cufe ||
        issuance.externalIdentity.providerOperationId !== referenceCode) {
      const diagnostic = "diagnostic" in issuance
        ? String((issuance as { diagnostic?: { code?: string } }).diagnostic?.code ?? issuance.kind)
        : issuance.kind;
      record("FACTUS", "document_issuance", "OBSERVED_FAIL", `kind=${issuance.kind};detail=${diagnostic};http=${issuance.providerStatus?.httpStatus ?? "none"}`);
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
    if (status.kind === "FOUND" && status.normalizedResult === "ACCEPTED" &&
        status.externalIdentity.providerOperationId === providerOperationId &&
        status.externalIdentity.number === billNumber &&
        status.externalIdentity.cufe === issuance.externalIdentity.cufe) {
      record("FACTUS", "document_status_query", "OBSERVED_PASS", `normalized=${status.normalizedResult};identity_match=true`);
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
    if (creditNote.kind === "EVIDENCED" && creditNote.normalizedResult === "ACCEPTED" &&
        !!creditNote.externalIdentity.number && creditNote.externalIdentity.providerOperationId === cnReference) {
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
      record("FACTUS", "credit_note_issuance", "OBSERVED_FAIL", `kind=${creditNote.kind};detail=${diagnostic};http=${creditNote.providerStatus?.httpStatus ?? "none"}`);
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

  // InsecureDerivedKeyProvider is TEST_ONLY. This exceptional gate is an
  // observed lab runner — force the test environment for the key provider only.
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";

  let secrets: EncryptedFileSecretStore | null = null;
  try {
    secrets = new EncryptedFileSecretStore(
      dir,
      new InsecureDerivedKeyProvider(dir),
      `factus-pay-sandbox-gate:${installationId}:${deviceId}:${companyId}`,
    );
    const store = new FactusPayCredentialStore(secrets, companyId);
    store.deposit({ environment: "SANDBOX", email, password });
    const client = new FactusPayClient(store, "SANDBOX", () => new Date(), fetch);

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
      : error instanceof Error ? error.name : "UNKNOWN";
    record("FACTUS_PAY", "authentication_and_collection_create", "OBSERVED_FAIL", `error_code=${code}`);
    record("FACTUS_PAY", "collection_status_query", "NOT_RUN", "create failed");
    record("FACTUS_PAY", "reconciliation_get", "NOT_RUN", "create failed");
    record("FACTUS_PAY", "official_payment_simulation", "NOT_RUN", "create failed");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    secrets?.destroy();
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
  let crashMessage: string | null = null;
  try {
    await runFactus(credential, signal);
    await runFactusPay(signal);
  } catch (error) {
    crashMessage = error instanceof Error ? error.name : "UNKNOWN";
    failed = true;
    console.error(`GATE_CRASH:${crashMessage}`);
  }

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
    crash: crashMessage,
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
    crash: crashMessage,
  }));

  if (failed) process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.name : "UNKNOWN";
  console.error(`GATE_CRASH:${message}`);
  // Last-resort evidence so the upload step is never empty on unexpected throws.
  try {
    const outDir = process.env.CAMACHO_SANDBOX_EVIDENCE_DIR
      ?? join(process.cwd(), "artifacts", "factus-sandbox-exceptional");
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `evidence-crash-${Date.now()}.json`);
    writeFileSync(outFile, `${JSON.stringify({
      gate: "factus-sandbox-exceptional",
      claim_level: "OBSERVED_ONLY",
      sandbox_verified_declared: false,
      crash: message,
      steps,
      generated_at: new Date().toISOString(),
      commit: process.env.REVIEWED_SHA ?? process.env.GITHUB_SHA ?? null,
    }, null, 2)}\n`, "utf8");
    console.log(`evidence_path=${outFile}`);
  } catch {
    // ignore secondary write failures
  }
  process.exit(1);
});
