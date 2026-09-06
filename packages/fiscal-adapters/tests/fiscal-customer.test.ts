import { describe, expect, it } from "vitest";
import {
  CUSTOMER_RULE_SOURCES,
  FiscalCustomerSchema,
  prepareCustomerForIssuance,
  validateFiscalCustomer,
  type FiscalCustomer,
  type FiscalCustomerFindingCode,
} from "../src/index.js";

/**
 * Estas pruebas fijan tres cosas distintas y conviene no confundirlas:
 * qué exige la documentación del proveedor, qué exigimos nosotros, y **qué
 * decidimos no comprobar**. Lo tercero es lo que más fácil se pierde.
 */

/** Persona natural con cédula. Caso mayoritario de un POS. */
const personaNatural: FiscalCustomer = {
  identificationDocumentCode: "13",
  identification: "1020304050",
  verificationDigit: null,
  legalOrganizationCode: "2",
  company: null,
  names: "Ana Restrepo",
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: "ana@example.co",
  phone: "3001234567",
  address: "Calle 1 # 2-3",
  countryCode: "CO",
  municipalityCode: "05001",
};

/** Persona jurídica con NIT y DV separado. */
const personaJuridica: FiscalCustomer = {
  identificationDocumentCode: "31",
  identification: "900123456",
  verificationDigit: "7",
  legalOrganizationCode: "1",
  company: "Comercializadora del Valle S.A.S.",
  names: null,
  tributeCode: "ZZ",
  fiscalResponsibilityCodes: ["R-99-PN"],
  email: "facturacion@example.co",
  phone: "6041234567",
  address: "Carrera 4 # 5-6",
  countryCode: "CO",
  municipalityCode: "05001",
};

const codes = (customer: FiscalCustomer): readonly FiscalCustomerFindingCode[] =>
  validateFiscalCustomer(customer).map((f) => f.code);

describe("un adquiriente correcto no produce hallazgos", () => {
  it("persona natural con cédula", () => {
    expect(validateFiscalCustomer(personaNatural)).toEqual([]);
  });

  it("persona jurídica con NIT y DV aparte", () => {
    expect(validateFiscalCustomer(personaJuridica)).toEqual([]);
  });
});

describe("las reglas escritas en la documentación del proveedor", () => {
  it("persona jurídica sin razón social se marca, y la regla es del proveedor", () => {
    const findings = validateFiscalCustomer({ ...personaJuridica, company: null });
    expect(findings).toEqual([
      { code: "COMPANY_REQUIRED_FOR_LEGAL_ENTITY", path: "company", source: "FACTUS_OFFICIAL_DOC" },
    ]);
  });

  it("persona natural sin nombres se marca", () => {
    const findings = validateFiscalCustomer({ ...personaNatural, names: null });
    expect(findings).toEqual([
      { code: "NAMES_REQUIRED_FOR_NATURAL_PERSON", path: "names", source: "FACTUS_OFFICIAL_DOC" },
    ]);
  });

  it("un código de tipo documental no verificado se rechaza", () => {
    expect(codes({ ...personaNatural, identificationDocumentCode: "22" })).toContain(
      "IDENTIFICATION_DOCUMENT_CODE_NOT_VERIFIED",
    );
  });

  it("una naturaleza jurídica no verificada se rechaza", () => {
    expect(codes({ ...personaNatural, legalOrganizationCode: "9" })).toContain(
      "LEGAL_ORGANIZATION_CODE_NOT_VERIFIED",
    );
  });

  it("un tributo no verificado se rechaza", () => {
    expect(codes({ ...personaNatural, tributeCode: "01" })).toContain("TRIBUTE_CODE_NOT_VERIFIED");
  });

  it("una responsabilidad fiscal no verificada se rechaza, y el hallazgo dice cuál", () => {
    const findings = validateFiscalCustomer({
      ...personaNatural,
      fiscalResponsibilityCodes: ["R-99-PN", "O-13"],
    });
    expect(findings).toEqual([
      {
        code: "FISCAL_RESPONSIBILITY_CODE_NOT_VERIFIED",
        path: "fiscalResponsibilityCodes[1]",
        source: "FACTUS_OFFICIAL_DOC",
      },
    ]);
  });
});

describe("la identificación viaja sin dígito de verificación", () => {
  it("un NIT escrito «900123456-7» se marca como DV pegado, no como formato raro", () => {
    const findings = validateFiscalCustomer({
      ...personaJuridica,
      identification: "900123456-7",
    });
    expect(findings).toEqual([
      {
        code: "IDENTIFICATION_CARRIES_VERIFICATION_DIGIT",
        path: "identification",
        source: "FACTUS_OFFICIAL_DOC",
      },
    ]);
  });

  it("una identificación no numérica sin guion se marca aparte, y esa regla es nuestra", () => {
    const findings = validateFiscalCustomer({ ...personaNatural, identification: "AB1020304" });
    expect(findings).toEqual([
      { code: "IDENTIFICATION_NOT_NUMERIC", path: "identification", source: "DERIVED" },
    ]);
  });
});

describe("el dígito de verificación: forma sí, valor no", () => {
  it("un NIT sin DV se marca, y la regla es nuestra porque la documentación no la declara condicional", () => {
    const findings = validateFiscalCustomer({ ...personaJuridica, verificationDigit: null });
    expect(findings).toEqual([
      { code: "VERIFICATION_DIGIT_REQUIRED_FOR_NIT", path: "verificationDigit", source: "DERIVED" },
    ]);
  });

  it("una cédula sin DV es correcta: el DV sólo se exige al NIT", () => {
    expect(validateFiscalCustomer({ ...personaNatural, verificationDigit: null })).toEqual([]);
  });

  it("un DV que no es un solo dígito se marca", () => {
    expect(codes({ ...personaJuridica, verificationDigit: "77" })).toContain(
      "VERIFICATION_DIGIT_MALFORMED",
    );
  });

  /**
   * `D-12`. El algoritmo del DV es módulo 11 y es público, pero no está en
   * ninguna fuente verificada de este repositorio. Un DV mal calculado emite
   * contra un tercero que no es. Mientras no haya fuente, **no se calcula**, y
   * esta prueba fija esa ausencia para que nadie la cierre por descuido
   * creyendo que ya estaba cubierta.
   */
  it("un DV con la forma correcta y el valor equivocado NO se detecta — deuda D-12", () => {
    expect(validateFiscalCustomer({ ...personaJuridica, verificationDigit: "0" })).toEqual([]);
  });
});

describe("lo que deliberadamente no se comprueba", () => {
  it("país y municipio pasan sin validar: no hay tabla verificada para ninguno", () => {
    expect(
      validateFiscalCustomer({
        ...personaNatural,
        countryCode: "ZZZ",
        municipalityCode: "00000",
      }),
    ).toEqual([]);
  });

  it("un correo con forma inválida sí se marca, y la regla es nuestra", () => {
    expect(validateFiscalCustomer({ ...personaNatural, email: "ana(arroba)example" })).toEqual([
      { code: "EMAIL_MALFORMED", path: "email", source: "DERIVED" },
    ]);
  });

  it("sin correo no hay hallazgo: es opcional", () => {
    expect(validateFiscalCustomer({ ...personaNatural, email: null })).toEqual([]);
  });
});

describe("la lista de responsabilidades vacía se marca en vez de suponerse", () => {
  it("un array presente y vacío no es lo mismo que ausente", () => {
    expect(
      validateFiscalCustomer({ ...personaNatural, fiscalResponsibilityCodes: [] }),
    ).toEqual([
      {
        code: "FISCAL_RESPONSIBILITIES_EMPTY",
        path: "fiscalResponsibilityCodes",
        source: "DERIVED",
      },
    ]);
  });
});

describe("el diagnóstico no filtra datos del adquiriente", () => {
  it("ningún hallazgo contiene la identificación, el correo, el teléfono ni la dirección", () => {
    const roto: FiscalCustomer = {
      identificationDocumentCode: "99",
      identification: "900123456-7",
      verificationDigit: "XX",
      legalOrganizationCode: "1",
      company: null,
      names: null,
      tributeCode: "99",
      fiscalResponsibilityCodes: [],
      email: "secreto(arroba)example",
      phone: "3009998877",
      address: "Calle secreta 9 # 9-9",
      countryCode: "CO",
      municipalityCode: "05001",
    };
    const findings = validateFiscalCustomer(roto);
    // Sin esta línea la prueba sería vacua: una lista vacía no contiene nada y
    // pasaría aunque el diagnóstico hubiera dejado de comprobar cualquier cosa.
    expect(findings).toHaveLength(7);
    const serializado = JSON.stringify(findings);
    for (const valor of [
      roto.identification,
      roto.verificationDigit,
      roto.email,
      roto.phone,
      roto.address,
      roto.identificationDocumentCode,
      roto.tributeCode,
    ]) {
      expect(serializado).not.toContain(valor);
    }
  });

  it("devuelve todos los hallazgos a la vez, no el primero", () => {
    const findings = validateFiscalCustomer({
      ...personaJuridica,
      company: null,
      identification: "900123456-7",
      verificationDigit: null,
      tributeCode: "99",
    });
    expect(findings.length).toBeGreaterThan(3);
  });

  it("toda regla declara una fuente del conjunto cerrado", () => {
    const findings = validateFiscalCustomer({
      ...personaNatural,
      identificationDocumentCode: "99",
      legalOrganizationCode: "9",
      tributeCode: "99",
      identification: "AB",
      fiscalResponsibilityCodes: ["O-13"],
      email: "no",
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(CUSTOMER_RULE_SOURCES).toContain(finding.source);
    }
  });
});

describe("preparar el adquiriente para emitir", () => {
  it("un adquiriente correcto queda READY y lleva el customer", () => {
    const readiness = prepareCustomerForIssuance({
      kind: "IDENTIFIED",
      customer: personaJuridica,
    });
    expect(readiness.kind).toBe("READY");
    if (readiness.kind !== "READY") throw new Error("esperaba READY");
    expect(readiness.customer).toEqual(personaJuridica);
  });

  it("un adquiriente inválido queda BLOCKED con sus hallazgos", () => {
    const readiness = prepareCustomerForIssuance({
      kind: "IDENTIFIED",
      customer: { ...personaJuridica, company: null },
    });
    expect(readiness.kind).toBe("BLOCKED");
    if (readiness.kind !== "BLOCKED") throw new Error("esperaba BLOCKED");
    expect(readiness.reason).toBe("CUSTOMER_INVALID");
    expect(readiness.findings.map((f) => f.code)).toEqual(["COMPANY_REQUIRED_FOR_LEGAL_ENTITY"]);
  });

  /**
   * La afirmación central del módulo: **una venta sin adquiriente identificado
   * no se rellena con el tercero genérico de la DIAN**, porque sus valores no
   * están verificados aquí. Bloquea, y el motivo nombra exactamente lo que
   * falta.
   */
  it("sin adquiriente identificado bloquea y nombra la fuente que falta, no inventa un genérico", () => {
    for (const reason of ["ANONYMOUS_COUNTER_SALE", "IDENTIFICATION_PENDING"] as const) {
      const readiness = prepareCustomerForIssuance({ kind: "NOT_IDENTIFIED", reason });
      expect(readiness.kind).toBe("BLOCKED");
      if (readiness.kind !== "BLOCKED") throw new Error("esperaba BLOCKED");
      expect(readiness.reason).toBe("GENERIC_ACQUIRER_NOT_VERIFIED");
      expect(readiness).not.toHaveProperty("customer");
    }
  });
});

describe("el esquema es estricto", () => {
  it("acepta la forma canónica", () => {
    expect(FiscalCustomerSchema.safeParse(personaJuridica).success).toBe(true);
  });

  it("rechaza una clave que no está en el contrato", () => {
    const conExtra = { ...personaNatural, nit: "900123456" };
    expect(FiscalCustomerSchema.safeParse(conExtra).success).toBe(false);
  });

  it("rechaza `undefined` donde el contrato declara `null`", () => {
    const conUndefined = { ...personaNatural, company: undefined };
    expect(FiscalCustomerSchema.safeParse(conUndefined).success).toBe(false);
  });
});
