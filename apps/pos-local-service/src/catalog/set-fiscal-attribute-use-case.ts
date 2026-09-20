import { createHash } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { validateFiscalDocumentItem, type FiscalItemFinding } from "@pos-platform/fiscal-adapters";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { PERMISSION_CATALOG_PRODUCT_REGISTER } from "./register-product-use-case.js";
import type { SetFiscalAttributeOutcome, SqliteCatalogStore } from "./sqlite-catalog-store.js";

/**
 * D-19 — escritura de los atributos fiscales de una presentación.
 *
 * La tabla `catalog_fiscal_attribute` tenía lectores y **ningún escritor**: el
 * ensamblado Factus la lee para cada línea y, al no encontrarla, se detenía en
 * `LINE_FISCAL_ATTRIBUTE_MISSING`. Ningún producto dado de alta por el POS se
 * podía facturar.
 *
 * Su razón de ser como caso de uso aparte —y no como un `CHECK` más de la
 * tabla— es que la base comprueba la **forma** de los códigos DIAN con `GLOB`
 * y no su **pertenencia** a las tablas verificadas. Un `unit_measure_code`
 * inventado con forma válida se guardaría sin protesta y sólo reventaría al
 * emitir, con la venta ya cobrada y el cliente delante. Aquí se comprueba
 * antes de escribir.
 *
 * **Permiso.** Reutiliza `CATALOG_PRODUCT_REGISTER` en vez de inventar uno
 * nuevo: quien da de alta el producto es quien declara sus códigos fiscales, y
 * un permiso nuevo exigiría sembrarlo en los roles —una decisión de
 * autorización que este cambio no tiene autorizada.
 */
export interface SetFiscalAttributeRequest {
  readonly presentationId: string;
  readonly codeReference: string;
  readonly unitMeasureCode: string;
  readonly standardCode: string;
  readonly taxCode: string;
  readonly taxRate: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

/** Código y ruta, jamás el valor: misma regla que `FiscalItemFinding`. */
export interface SetFiscalAttributeFinding {
  readonly code: string;
  readonly path: string;
}

export type SetFiscalAttributeResult =
  | SetFiscalAttributeOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | {
      readonly kind: "FISCAL_CODES_NOT_VERIFIED";
      readonly findings: readonly SetFiscalAttributeFinding[];
    };

/**
 * Rutas de `validateFiscalDocumentItem` que pertenecen al **atributo**.
 *
 * El validador comprueba la línea completa —cantidad, precio, descuento—, y
 * esos tres los aporta la venta, no el catálogo. Filtrar por ruta evita
 * devolver al operador hallazgos sobre valores que él no escribió y que
 * proceden de la sonda neutra de abajo.
 */
const ATTRIBUTE_PATHS = new Set(["unitMeasureCode", "standardCode", "taxes[0].code", "taxes[0].rate"]);

function attributeFindings(findings: readonly FiscalItemFinding[]): readonly SetFiscalAttributeFinding[] {
  return findings
    .filter((finding) => ATTRIBUTE_PATHS.has(finding.path))
    .map((finding) => ({ code: finding.code, path: finding.path }));
}

function requestChecksum(request: SetFiscalAttributeRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      code_reference: request.codeReference,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      presentation_id: request.presentationId,
      standard_code: request.standardCode,
      status: request.status,
      tax_code: request.taxCode,
      tax_rate: request.taxRate,
      unit_measure_code: request.unitMeasureCode,
    }))
    .digest("hex");
}

export class SetFiscalAttributeUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: SetFiscalAttributeRequest,
    at: Date = new Date(),
  ): SetFiscalAttributeResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CATALOG_PRODUCT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    // Sonda neutra: cantidad y precio unitarios y sin descuento. No describen
    // ninguna venta —no existe todavía—, sólo sirven para que el validador
    // pueda pronunciarse sobre los cuatro códigos sin marcar de paso campos
    // que este caso de uso no escribe.
    const findings = attributeFindings(validateFiscalDocumentItem({
      codeReference: request.codeReference,
      name: request.codeReference,
      quantity: "1.000000",
      unitPrice: "1.000000",
      unitMeasureCode: request.unitMeasureCode,
      standardCode: request.standardCode,
      discount: null,
      taxes: [{ code: request.taxCode, rate: request.taxRate }],
    }));
    if (findings.length > 0) return { kind: "FISCAL_CODES_NOT_VERIFIED", findings };

    return this.catalogStore.setFiscalAttribute({
      scope,
      sessionId,
      operatorUserId,
      presentationId: request.presentationId,
      codeReference: request.codeReference,
      unitMeasureCode: request.unitMeasureCode,
      standardCode: request.standardCode,
      taxCode: request.taxCode,
      taxRate: request.taxRate,
      status: request.status,
      operationId: uuidV7(),
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
