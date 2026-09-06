import * as z from "zod";
import type { CredentialReference } from "../credential.js";
import type { FiscalDocumentType } from "../capability.js";
import { fiscalDocumentTypeForCode } from "../dian/codes.js";
import type { FiscalEnvironment } from "../provider.js";

/**
 * `NumberingRangePort` — `electronic-invoicing.md` §Puertos.
 *
 * - consultar capacidades de rango;
 * - sincronizar rangos y prefijos;
 * - validar vigencia conocida;
 * - **no asignar localmente un consecutivo si el proveedor conserva esa
 *   autoridad**.
 *
 * La última obligación es prohibitiva, y aquí se cumple de la forma más simple
 * que existe: **este puerto no expone ninguna operación de asignación**. No hay
 * un método que desactivar ni una bandera que respetar. La autoridad se
 * consulta; el consecutivo, si es del proveedor, jamás se fabrica desde aquí.
 *
 * Además `D-6` del ledger sigue vigente: la numeración comercial
 * (`sales_document_series_counter`) no es numeración fiscal y reutilizarla
 * violaría la autorización DIAN.
 */

export const NUMBERING_AUTHORITIES = ["PROVIDER", "LOCAL", "UNKNOWN"] as const;

export type NumberingAuthority = (typeof NUMBERING_AUTHORITIES)[number];

export const NumberingAuthoritySchema = z.enum(NUMBERING_AUTHORITIES);

export interface NumberingRangeSnapshot {
  readonly rangeId: string;
  readonly documentType: FiscalDocumentType;
  readonly prefix: string;
  readonly authority: NumberingAuthority;
  readonly resolutionNumber: string | null;
  readonly rangeFrom: number;
  readonly rangeTo: number;
  /** Consecutivo alcanzado. `null` si el proveedor no lo informa. */
  readonly currentNumber: number | null;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  /**
   * Vigencia **según el proveedor**. `null` cuando no la declara.
   *
   * Cuando existe, manda sobre la aritmética de fechas: el proveedor conoce su
   * calendario y sus reglas de habilitación; nosotros sólo tenemos dos cadenas.
   */
  readonly providerActive: boolean | null;
  readonly providerExpired: boolean | null;
  /**
   * Código de tipo documental **en crudo del proveedor**, sin traducir.
   * Traducirlo exige la tabla de códigos DIAN, que no existe (`D-9`).
   */
  readonly providerDocumentCode: string | null;
}

export interface NumberingRangeQuery {
  readonly documentType: FiscalDocumentType;
  readonly environment: FiscalEnvironment;
  readonly credential: CredentialReference;
}

export type NumberingRangeOutcome =
  | { readonly kind: "SYNCHRONIZED"; readonly ranges: readonly NumberingRangeSnapshot[] }
  | { readonly kind: "UNSUPPORTED"; readonly reasonCode: string }
  | { readonly kind: "UNAVAILABLE"; readonly reasonCode: string };

/** Vigencia conocida. `UNKNOWN` cuando el rango no declara ventana. */
export type RangeValidity = "VALID" | "EXPIRED" | "NOT_YET_VALID" | "UNKNOWN";

export interface NumberingRangePort {
  synchronizeRanges(
    query: NumberingRangeQuery,
    signal: AbortSignal,
  ): Promise<NumberingRangeOutcome>;
}

/**
 * La prohibición, expresada como predicado consultable.
 *
 * Devuelve `true` sólo cuando la autoridad es explícitamente local. `UNKNOWN`
 * no habilita: no saber quién manda no es permiso para mandar.
 */
export function mayAllocateLocally(snapshot: NumberingRangeSnapshot): boolean {
  return snapshot.authority === "LOCAL";
}

/**
 * Reparte los rangos entre los que **sí** corresponden al tipo documental y los
 * que no se pueden clasificar.
 *
 * Emitir con el rango de otro tipo documental es un error fiscal, no de
 * programa: la DIAN autoriza cada resolución para un tipo concreto. Y descartar
 * en silencio lo que no se sabe clasificar es igual de peligroso, porque
 * esconde que el catálogo de códigos está incompleto (`D-9`).
 *
 * Por eso devuelve **las dos listas**: nada desaparece.
 */
export function selectRangesForDocumentType(
  ranges: readonly NumberingRangeSnapshot[],
  documentType: FiscalDocumentType,
): {
  readonly matching: readonly NumberingRangeSnapshot[];
  readonly unclassified: readonly NumberingRangeSnapshot[];
} {
  const matching: NumberingRangeSnapshot[] = [];
  const unclassified: NumberingRangeSnapshot[] = [];
  for (const range of ranges) {
    const resolved = fiscalDocumentTypeForCode(range.providerDocumentCode);
    if (resolved === null) unclassified.push(range);
    else if (resolved === documentType) matching.push(range);
  }
  return { matching, unclassified };
}

/**
 * Vigencia evaluada contra un instante dado, sin adivinar la ausente.
 *
 * Si el proveedor declara su propia vigencia, **manda la suya**: conoce su
 * calendario y sus reglas de habilitación, y nosotros sólo tenemos dos cadenas
 * de fecha. Sólo cuando no la declara se cae a la aritmética local.
 */
export function evaluateRangeValidity(
  snapshot: NumberingRangeSnapshot,
  atIso: string,
): RangeValidity {
  if (snapshot.providerExpired === true) return "EXPIRED";
  if (snapshot.providerActive === false && snapshot.providerExpired !== false) return "UNKNOWN";
  if (snapshot.validFrom === null && snapshot.validUntil === null) {
    return snapshot.providerActive === true ? "VALID" : "UNKNOWN";
  }
  const at = Date.parse(atIso);
  if (Number.isNaN(at)) return "UNKNOWN";
  if (snapshot.validFrom !== null) {
    const from = Date.parse(snapshot.validFrom);
    if (Number.isNaN(from)) return "UNKNOWN";
    if (at < from) return "NOT_YET_VALID";
  }
  if (snapshot.validUntil !== null) {
    const until = Date.parse(snapshot.validUntil);
    if (Number.isNaN(until)) return "UNKNOWN";
    if (at > until) return "EXPIRED";
  }
  return "VALID";
}
