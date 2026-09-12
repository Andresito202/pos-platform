import { describe, it, expect } from "vitest";
import {
  CatalogItemResponseSchema,
  IpcMessageTypeSchema,
  PaymentRegisterCashResponseSchema,
  SaleCreateResponseSchema,
  CashShiftOpenResponseSchema,
  type IpcMessageType,
} from "@pos-platform/contracts";
import {
  IPC_RESPONSE_SCHEMA_BY_MESSAGE_TYPE,
  responseSchemaFor,
} from "../src/response-schemas.js";

describe("tabla de esquemas de respuesta", () => {
  it("cubre todas las operaciones que el contrato declara", () => {
    expect(Object.keys(IPC_RESPONSE_SCHEMA_BY_MESSAGE_TYPE).sort())
      .toEqual([...IpcMessageTypeSchema.options].sort());
  });

  it("cada operación comercial resuelve a SU esquema, no a uno genérico", () => {
    expect(responseSchemaFor("cash.shift.open")).toBe(CashShiftOpenResponseSchema);
    expect(responseSchemaFor("sale.create")).toBe(SaleCreateResponseSchema);
    expect(responseSchemaFor("catalog.item.find")).toBe(CatalogItemResponseSchema);
    expect(responseSchemaFor("payment.register.cash")).toBe(PaymentRegisterCashResponseSchema);
  });

  it("ninguna operación queda sin esquema", () => {
    for (const messageType of IpcMessageTypeSchema.options as IpcMessageType[]) {
      expect(responseSchemaFor(messageType), messageType).toBeDefined();
    }
  });

  it("el esquema de una venta acepta un resultado de venta y rechaza el genérico de operación", () => {
    const envelope = {
      protocol_version: "1.0.0",
      request_id: "018f0000-0000-7000-8000-000000000001",
      correlation_id: "018f0000-0000-7000-8000-000000000002",
      operation_id: "018f0000-0000-7000-8000-000000000003",
      status: "SUCCEEDED",
      result_code: "CREATED",
      result_schema_version: "1.0.0",
      error: null,
      server_time: "2026-09-12T00:00:00.000Z",
    };
    const saleResult = {
      outcome: "CREATED",
      sale_id: "018f0000-0000-7000-8000-000000000004",
      sale_number: 1,
      payable_amount: "3500.000000",
      calculation_checksum: "a".repeat(64),
    };

    // Con el esquema correcto pasa…
    expect(() => responseSchemaFor("sale.create").parse({ ...envelope, result: saleResult }))
      .not.toThrow();
    // …y con el genérico que el cliente usaba antes, no. Ésa era la avería.
    expect(() => responseSchemaFor("operation.result.get").parse({ ...envelope, result: saleResult }))
      .toThrow();
  });
});
