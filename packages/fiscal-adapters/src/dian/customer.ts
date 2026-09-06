import * as z from "zod";
import {
  FISCAL_RESPONSIBILITY_CODES,
  IDENTIFICATION_DOCUMENT_CODES,
  LEGAL_ORGANIZATION_CODES,
  TRIBUTE_CODES,
  isVerifiedCode,
  requiredCustomerNameField,
} from "./codes.js";

/**
 * Adquiriente fiscal — segunda pieza de `D-9`.
 *
 * `provider-payload-shapes.md` §FACTUS registra el `customer{}` que exige el
 * cuerpo de emisión y anota, en la misma fila, «**NO EXISTE** — `Customer` está
 * en la ruta crítica». Esto es esa fila.
 *
 * El módulo declara **la forma canónica** del adquiriente y las reglas que se
 * pueden comprobar contra las tablas DIAN ya verificadas. No habla con ningún
 * proveedor y no persiste nada: traducir esta forma al `customer{}` de FACTUS,
 * al de SIIGO o al de ALEGRA es trabajo del adapter, y guardarla es trabajo del
 * módulo comercial.
 *
 * ## La regla que hereda de `codes.ts`
 *
 * Cada regla declara **de dónde sale**. `FACTUS_OFFICIAL_DOC` es una exigencia
 * escrita en la documentación oficial que aportó el propietario; `DERIVED` es
 * una regla que impusimos nosotros con un motivo, y va anotada con ese motivo.
 * Mezclarlas dejaría al consumidor sin saber si un hallazgo lo rechaza el
 * proveedor o lo rechazamos nosotros, que son dos conversaciones distintas.
 *
 * ## Lo que este módulo NO hace, a propósito
 *
 * **No calcula ni verifica el dígito de verificación.** El algoritmo del DV es
 * módulo 11 sobre el NIT, es público, y aun así no está en ninguna fuente
 * verificada de este repositorio. Un DV mal calculado produce una factura
 * rechazada o —peor— emitida contra un tercero que no es. Se declara como dato
 * de entrada y se comprueba su **forma**, nunca su valor. Queda registrado como
 * deuda `D-12`.
 *
 * **No inventa el adquiriente genérico.** La venta de mostrador a un cliente
 * anónimo es el caso mayoritario de un POS y la DIAN tiene un tercero genérico
 * para eso, pero sus valores exactos no están verificados aquí. En vez de
 * rellenarlo con una suposición, la ausencia se modela como un estado propio y
 * la emisión se **bloquea** con un motivo que dice exactamente qué falta.
 */

/** De dónde sale cada regla que se comprueba aquí. */
export const CUSTOMER_RULE_SOURCES = ["FACTUS_OFFICIAL_DOC", "DERIVED"] as const;

export type CustomerRuleSource = (typeof CUSTOMER_RULE_SOURCES)[number];

export const CustomerRuleSourceSchema = z.enum(CUSTOMER_RULE_SOURCES);

/**
 * Forma canónica del adquiriente.
 *
 * Los nombres son los nuestros, no los de FACTUS: el adapter traduce. Lo que sí
 * se conserva del contrato del proveedor es la **separación entre
 * `identification` y `verificationDigit`**, porque la documentación es explícita
 * en que la identificación viaja **sin DV**. Un NIT escrito «900123456-7» en el
 * campo de identificación es el error que esta separación existe para impedir.
 */
export interface FiscalCustomer {
  /** Código DIAN de tipo de documento (`IDENTIFICATION_DOCUMENT_CODES`). */
  readonly identificationDocumentCode: string;
  /** Identificación **sin** dígito de verificación. */
  readonly identification: string;
  /** El DV, aparte. `null` cuando no aplica o no se capturó. */
  readonly verificationDigit: string | null;
  /** Código DIAN de naturaleza jurídica: `"1"` jurídica, `"2"` natural. */
  readonly legalOrganizationCode: string;
  /** Razón social. Obligatoria para persona jurídica. */
  readonly company: string | null;
  /** Nombre y apellidos. Obligatorios para persona natural. */
  readonly names: string | null;
  /** Código DIAN de tributo. */
  readonly tributeCode: string;
  /** Códigos DIAN de responsabilidad fiscal. */
  readonly fiscalResponsibilityCodes: readonly string[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  /**
   * País y municipio se conservan **en crudo, sin validar**: no existe tabla
   * verificada para ninguno de los dos en este repositorio, y validar contra
   * una tabla inventada rechazaría adquirientes correctos.
   */
  readonly countryCode: string | null;
  readonly municipalityCode: string | null;
}

const NON_EMPTY = z.string().min(1).max(200);
const OPTIONAL_TEXT = z.string().min(1).max(200).nullable();

export const FiscalCustomerSchema: z.ZodType<FiscalCustomer> = z.strictObject({
  identificationDocumentCode: z.string().min(1).max(8),
  identification: z.string().min(1).max(40),
  verificationDigit: z.string().min(1).max(2).nullable(),
  legalOrganizationCode: z.string().min(1).max(8),
  company: OPTIONAL_TEXT,
  names: OPTIONAL_TEXT,
  tributeCode: z.string().min(1).max(8),
  fiscalResponsibilityCodes: z.array(z.string().min(1).max(16)).max(32),
  email: OPTIONAL_TEXT,
  phone: OPTIONAL_TEXT,
  address: OPTIONAL_TEXT,
  countryCode: OPTIONAL_TEXT,
  municipalityCode: OPTIONAL_TEXT,
});

/**
 * Códigos de hallazgo.
 *
 * Un hallazgo lleva **código y ruta, jamás el valor del campo** — la misma
 * regla que ya fija `PayloadValidationFinding` en el puerto de emisión. Un
 * adquiriente contiene identificación, correo y dirección de una persona real:
 * un diagnóstico que los imprima los filtra a los registros.
 */
export const FISCAL_CUSTOMER_FINDING_CODES = [
  "IDENTIFICATION_DOCUMENT_CODE_NOT_VERIFIED",
  "LEGAL_ORGANIZATION_CODE_NOT_VERIFIED",
  "TRIBUTE_CODE_NOT_VERIFIED",
  "FISCAL_RESPONSIBILITY_CODE_NOT_VERIFIED",
  "FISCAL_RESPONSIBILITIES_EMPTY",
  "COMPANY_REQUIRED_FOR_LEGAL_ENTITY",
  "NAMES_REQUIRED_FOR_NATURAL_PERSON",
  "IDENTIFICATION_CARRIES_VERIFICATION_DIGIT",
  "IDENTIFICATION_NOT_NUMERIC",
  "VERIFICATION_DIGIT_REQUIRED_FOR_NIT",
  "VERIFICATION_DIGIT_MALFORMED",
  "EMAIL_MALFORMED",
] as const;

export type FiscalCustomerFindingCode = (typeof FISCAL_CUSTOMER_FINDING_CODES)[number];

export interface FiscalCustomerFinding {
  readonly code: FiscalCustomerFindingCode;
  readonly path: string;
  readonly source: CustomerRuleSource;
}

export const FiscalCustomerFindingSchema = z.strictObject({
  code: z.enum(FISCAL_CUSTOMER_FINDING_CODES),
  path: NON_EMPTY,
  source: CustomerRuleSourceSchema,
});

/** Código DIAN del NIT. Único tipo documental con dígito de verificación. */
const NIT_CODE = "31";

const DIGITS_ONLY = /^[0-9]+$/;
const SINGLE_DIGIT = /^[0-9]$/;
const EmailSchema = z.email();

const DOC = "FACTUS_OFFICIAL_DOC" as const;
const DER = "DERIVED" as const;

/**
 * Comprueba el adquiriente contra las tablas DIAN verificadas y las reglas
 * documentadas.
 *
 * Devuelve **todos** los hallazgos, no el primero: quien captura un adquiriente
 * en una caja necesita corregirlo de una vez, no descubrir un error por intento.
 *
 * Una lista vacía significa «no encontré nada que contradiga lo verificado».
 * **No significa que la DIAN vaya a aceptarlo**: aquí no se comprueba lo que no
 * tiene fuente —el DV, el municipio, el país—, y eso está dicho campo por campo.
 */
export function validateFiscalCustomer(
  customer: FiscalCustomer,
): readonly FiscalCustomerFinding[] {
  const findings: FiscalCustomerFinding[] = [];
  const add = (
    code: FiscalCustomerFindingCode,
    path: string,
    source: CustomerRuleSource,
  ): void => {
    findings.push({ code, path, source });
  };

  if (!isVerifiedCode(IDENTIFICATION_DOCUMENT_CODES, customer.identificationDocumentCode)) {
    add("IDENTIFICATION_DOCUMENT_CODE_NOT_VERIFIED", "identificationDocumentCode", DOC);
  }
  if (!isVerifiedCode(LEGAL_ORGANIZATION_CODES, customer.legalOrganizationCode)) {
    add("LEGAL_ORGANIZATION_CODE_NOT_VERIFIED", "legalOrganizationCode", DOC);
  }
  if (!isVerifiedCode(TRIBUTE_CODES, customer.tributeCode)) {
    add("TRIBUTE_CODE_NOT_VERIFIED", "tributeCode", DOC);
  }

  // `responsibilities[]` figura en el cuerpo documentado. Un array vacío no es
  // «ausente»: es un array presente que no dice nada, y la regla 2 del contrato
  // —un opcional de tipo array, una vez recibe datos, pasa a ser obligatorio con
  // sus campos internos— deja ese caso sin definir. Se marca en vez de suponer.
  if (customer.fiscalResponsibilityCodes.length === 0) {
    add("FISCAL_RESPONSIBILITIES_EMPTY", "fiscalResponsibilityCodes", DER);
  }
  customer.fiscalResponsibilityCodes.forEach((code, index) => {
    if (!isVerifiedCode(FISCAL_RESPONSIBILITY_CODES, code)) {
      add(
        "FISCAL_RESPONSIBILITY_CODE_NOT_VERIFIED",
        `fiscalResponsibilityCodes[${String(index)}]`,
        DOC,
      );
    }
  });

  const nameField = requiredCustomerNameField(customer.legalOrganizationCode);
  if (nameField === "company" && customer.company === null) {
    add("COMPANY_REQUIRED_FOR_LEGAL_ENTITY", "company", DOC);
  }
  if (nameField === "names" && customer.names === null) {
    add("NAMES_REQUIRED_FOR_NATURAL_PERSON", "names", DOC);
  }

  // La documentación es explícita: la identificación viaja **sin DV**. Cualquier
  // carácter que no sea dígito delata un DV pegado —«900123456-7»— o un formato
  // que el proveedor no espera.
  if (!DIGITS_ONLY.test(customer.identification)) {
    const code = customer.identification.includes("-")
      ? "IDENTIFICATION_CARRIES_VERIFICATION_DIGIT"
      : "IDENTIFICATION_NOT_NUMERIC";
    add(code, "identification", code === "IDENTIFICATION_CARRIES_VERIFICATION_DIGIT" ? DOC : DER);
  }

  if (customer.verificationDigit !== null && !SINGLE_DIGIT.test(customer.verificationDigit)) {
    add("VERIFICATION_DIGIT_MALFORMED", "verificationDigit", DER);
  }
  // Un NIT sin DV no lo puede validar la DIAN. La regla es nuestra —la
  // documentación lista `dv` sin declararlo condicional— y por eso va `DERIVED`.
  if (customer.identificationDocumentCode === NIT_CODE && customer.verificationDigit === null) {
    add("VERIFICATION_DIGIT_REQUIRED_FOR_NIT", "verificationDigit", DER);
  }

  if (customer.email !== null && !EmailSchema.safeParse(customer.email).success) {
    add("EMAIL_MALFORMED", "email", DER);
  }

  return findings;
}

/**
 * Por qué no hay adquiriente identificado.
 *
 * Son dos estados de caja, no una afirmación fiscal: ninguno declara nada ante
 * la DIAN.
 */
export const CUSTOMER_ABSENCE_REASONS = [
  "ANONYMOUS_COUNTER_SALE",
  "IDENTIFICATION_PENDING",
] as const;

export type CustomerAbsenceReason = (typeof CUSTOMER_ABSENCE_REASONS)[number];

export const CustomerAbsenceReasonSchema = z.enum(CUSTOMER_ABSENCE_REASONS);

/**
 * Lo que la caja resuelve: hay adquiriente o no lo hay.
 *
 * Que «no lo hay» sea una rama del tipo y no un `null` es deliberado: obliga a
 * quien emite a decidir qué hace con ese caso en vez de heredar un valor por
 * defecto sin darse cuenta.
 */
export type FiscalCustomerResolution =
  | { readonly kind: "IDENTIFIED"; readonly customer: FiscalCustomer }
  | { readonly kind: "NOT_IDENTIFIED"; readonly reason: CustomerAbsenceReason };

/** Por qué la emisión no puede seguir adelante con este adquiriente. */
export const CUSTOMER_BLOCK_REASONS = [
  "CUSTOMER_INVALID",
  "GENERIC_ACQUIRER_NOT_VERIFIED",
] as const;

export type CustomerBlockReason = (typeof CUSTOMER_BLOCK_REASONS)[number];

/**
 * Resultado de preparar el adquiriente para emitir.
 *
 * Sólo la rama `READY` lleva el `customer`, así que **no existe forma de emitir
 * con un adquiriente bloqueado**: no compila. Es la misma técnica que usa
 * `DocumentIssuanceOutcome`, donde sólo `EVIDENCED` declara el resultado
 * normalizado.
 */
export type CustomerIssuanceReadiness =
  | { readonly kind: "READY"; readonly customer: FiscalCustomer }
  | {
      readonly kind: "BLOCKED";
      readonly reason: CustomerBlockReason;
      readonly findings: readonly FiscalCustomerFinding[];
    };

/**
 * Decide si se puede emitir con lo que la caja resolvió.
 *
 * Un adquiriente ausente **bloquea**, y bloquea con un motivo que nombra la
 * pieza que falta: `GENERIC_ACQUIRER_NOT_VERIFIED`. Sustituirlo aquí por el
 * tercero genérico de la DIAN sería inventar un dato fiscal —el error que
 * `codes.ts` existe para no repetir—, y sustituirlo por vacío emitiría una
 * factura sin adquiriente. Bloquear es lo único honesto mientras esa fuente no
 * esté verificada.
 */
export function prepareCustomerForIssuance(
  resolution: FiscalCustomerResolution,
): CustomerIssuanceReadiness {
  if (resolution.kind === "NOT_IDENTIFIED") {
    return { kind: "BLOCKED", reason: "GENERIC_ACQUIRER_NOT_VERIFIED", findings: [] };
  }
  const findings = validateFiscalCustomer(resolution.customer);
  if (findings.length > 0) {
    return { kind: "BLOCKED", reason: "CUSTOMER_INVALID", findings };
  }
  return { kind: "READY", customer: resolution.customer };
}
