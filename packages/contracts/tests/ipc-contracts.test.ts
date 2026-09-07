import { describe, expect, it } from "vitest";
import {
  CustomerRegisterRequestSchema,
  OperationConfirmRequestSchema,
  OperationResultRequestSchema,
  RuntimeHandshakeRequestSchema,
  RuntimeStatusRequestSchema,
} from "../src/index.js";

const metadata = {
  protocol_version: "1.0.0",
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  correlation_id: "550e8400-e29b-41d4-a716-446655440001",
  payload_schema_version: "1.0.0",
};

describe("TECH-003 IPC contracts", () => {
  it("allowlists exact runtime status messages", () => {
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "runtime.status.get", payload: {} }).success).toBe(true);
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "shell.execute", payload: {} }).success).toBe(false);
  });
  it("rejects unexpected runtime status payload fields", () => {
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "runtime.status.get", payload: { shell: true } }).success).toBe(false);
  });
  it("requires both identities when querying an uncertain operation", () => {
    expect(OperationResultRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.result.get",
      payload: { operation_id: "550e8400-e29b-41d4-a716-446655440002", idempotency_key: "sale:create:1" },
    }).success).toBe(true);
    expect(OperationResultRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.result.get",
      payload: { operation_id: "550e8400-e29b-41d4-a716-446655440002" },
    }).success).toBe(false);
  });
  it("accepts a domain-agnostic operation confirmation with idempotency", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      operation_id: "550e8400-e29b-41d4-a716-446655440020",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: { note: "example" } },
    }).success).toBe(true);
  });
  it("requires operation_id alongside idempotency_key for operation.confirm", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: {} },
    }).success).toBe(false);
  });
  it("rejects unexpected operation.confirm payload fields", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      operation_id: "550e8400-e29b-41d4-a716-446655440020",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: {}, shell: true },
    }).success).toBe(false);
  });
  it("wraps the strict handshake snapshot", () => {
    expect(RuntimeHandshakeRequestSchema.safeParse({
      ...metadata,
      message_type: "runtime.handshake",
      payload: {
        desktop_version: "1.4.0", service_version: "1.4.2", protocol_min: "1.2.0", protocol_max: "1.5.0",
        installation_id: "550e8400-e29b-41d4-a716-446655440010",
        device_id: "550e8400-e29b-41d4-a716-446655440011", schema_version: "003", service_state: "READY",
      },
    }).success).toBe(true);
  });
});


/**
 * `D-9` — el adquiriente en la frontera.
 *
 * Estas pruebas fijan una distinción que ya costó un fallo: **un código DIAN no
 * es un `StableCode`**. El esquema de códigos estables exige empezar por
 * mayúscula, y el catálogo de la DIAN es mayoritariamente numérico. Reutilizarlo
 * rechazaba `"31"`, `"13"` y `"1"` en el borde, y sólo se veía al llegar la
 * primera petición real.
 */
describe("customer.register — la frontera del adquiriente", () => {
  const payload = {
    identification_document_code: "31",
    identification: "900123456",
    verification_digit: "7",
    legal_organization_code: "1",
    company: "Comercializadora del Valle S.A.S.",
    names: null,
    tribute_code: "ZZ",
    fiscal_responsibility_codes: ["R-99-PN"],
    email: "facturacion@example.co",
    phone: "6041234567",
    address: "Carrera 4 # 5-6",
    country_code: "CO",
    municipality_code: "05001",
  };

  const request = (overrides: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "customer.register",
    operation_id: "550e8400-e29b-41d4-a716-446655440002",
    idempotency_key: "customer:register:1",
    payload,
    ...overrides,
  });

  it("acepta los códigos DIAN numéricos, que son la mayoría del catálogo", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request()).success).toBe(true);
  });

  it("acepta también los alfanuméricos con guion, como R-99-PN", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, fiscal_responsibility_codes: ["R-99-PN", "ZZ"] },
    })).success).toBe(true);
  });

  /**
   * La documentación de emisión es taxativa: la identificación viaja **sin**
   * dígito de verificación. Que el contrato lo rechace evita que un
   * «900123456-7» llegue siquiera a la capa confiable.
   */
  it("rechaza una identificación con el dígito de verificación pegado", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, identification: "900123456-7" },
    })).success).toBe(false);
  });

  it("rechaza un DV que no sea un solo dígito", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, verification_digit: "77" },
    })).success).toBe(false);
  });

  it("rechaza un campo que no está en el contrato", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, nit: "900123456" },
    })).success).toBe(false);
  });

  /**
   * El renderer transporta intención, nunca identidad. Un payload que afirme
   * quién es el llamador se rechaza en el sobre, no por convención.
   */
  it("rechaza que el llamador afirme identidad", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      actor_type: "USER",
    })).success).toBe(false);
  });

  it("exige clave de idempotencia: registrar un tercero es una operación", () => {
    const { idempotency_key: _omitted, ...withoutKey } = request();
    expect(CustomerRegisterRequestSchema.safeParse(withoutKey).success).toBe(false);
  });
});
