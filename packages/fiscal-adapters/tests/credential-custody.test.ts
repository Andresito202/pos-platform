import { describe, expect, it } from "vitest";
import {
  CredentialFieldSchema,
  CredentialReferenceSchema,
  CredentialRequirementSchema,
  redactCredentialValues,
  type CredentialRequirement,
} from "../src/index.js";

/**
 * `fiscal-adapter-gate.md` §12: las credenciales de sandbox no son rotativas,
 * lo que **aumenta** la exigencia de custodia porque no hay rotación que mitigue
 * una fuga. Estas pruebas comprueban que la forma del tipo colabora con esa
 * regla en vez de depender de la disciplina de quien escribe el adapter.
 */

const FACTUS_SHAPE: CredentialRequirement = {
  transport: "OAUTH2_PASSWORD_GRANT",
  tokenLifecycle: "ACCESS_AND_REFRESH_TOKEN",
  fields: [
    { name: "client_id", source: "CUSTOMER", secret: false },
    { name: "client_secret", source: "CUSTOMER", secret: true },
    { name: "username", source: "CUSTOMER", secret: false },
    { name: "password", source: "CUSTOMER", secret: true },
  ],
  neverAccountPassword: false,
};

describe("la declaración no puede transportar un valor de credencial", () => {
  it("rechaza un campo que traiga una clave de valor", () => {
    expect(() =>
      CredentialFieldSchema.parse({
        name: "client_secret",
        source: "CUSTOMER",
        secret: true,
        value: "cualquier-cosa",
      }),
    ).toThrow();
  });

  it("rechaza cualquier clave no declarada, no sólo las que suenan a secreto", () => {
    expect(() =>
      CredentialRequirementSchema.parse({ ...FACTUS_SHAPE, token: "algo" }),
    ).toThrow();
  });

  it("acepta la forma declarada sin valores", () => {
    expect(CredentialRequirementSchema.parse(FACTUS_SHAPE).fields).toHaveLength(4);
  });
});

describe("la referencia al secreto es opaca", () => {
  it("acepta una referencia con espacio de nombres y versión", () => {
    const reference = CredentialReferenceSchema.parse({
      secretRef: "sec004:fiscal:factus:sandbox",
      version: "3",
    });
    expect(reference.secretRef).toContain("sec004:");
  });

  it("rechaza una referencia que no siga la forma de identificador", () => {
    expect(() =>
      CredentialReferenceSchema.parse({ secretRef: "no es una referencia", version: "1" }),
    ).toThrow();
  });

  it("rechaza claves adicionales que pudieran colar el secreto junto a la referencia", () => {
    expect(() =>
      CredentialReferenceSchema.parse({
        secretRef: "sec004:fiscal:factus",
        version: "1",
        secret: "valor",
      }),
    ).toThrow();
  });
});

describe("redacción obligatoria en logs y errores (§12.4)", () => {
  it("redacta los campos declarados secretos y deja los públicos legibles", () => {
    const message = 'auth falló: client_id=pos-app client_secret=abc123 username=api password=xyz';
    const redacted = redactCredentialValues(message, FACTUS_SHAPE);
    expect(redacted).toContain("client_id=pos-app");
    expect(redacted).toContain("username=api");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("xyz");
  });

  it("redacta la cabecera de autorización aunque no sea un campo declarado", () => {
    const redacted = redactCredentialValues(
      "GET /v2/bills\nAuthorization: Bearer eyJhbGciOi.token",
      FACTUS_SHAPE,
    );
    expect(redacted).not.toContain("eyJhbGciOi.token");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacta también en JSON, que es como llega la respuesta del proveedor", () => {
    const redacted = redactCredentialValues(
      '{"client_secret":"s3cr3t","expires_in":3600}',
      FACTUS_SHAPE,
    );
    expect(redacted).not.toContain("s3cr3t");
    expect(redacted).toContain("expires_in");
  });
});
