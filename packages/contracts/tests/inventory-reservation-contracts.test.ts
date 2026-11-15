import { describe, expect, it } from "vitest";
import {
  IpcRequestSchema,
  InventoryReservationCreateRequestSchema,
  InventoryReservationReleaseRequestSchema,
} from "../src/index.js";

const ids = {
  request: "018f0000-0000-7000-8000-000000000001",
  correlation: "018f0000-0000-7000-8000-000000000002",
  operation: "018f0000-0000-7000-8000-000000000003",
  presentation: "018f0000-0000-7000-8000-000000000004",
  reservation: "018f0000-0000-7000-8000-000000000005",
};

const base = {
  protocol_version: "1.0.0",
  request_id: ids.request,
  correlation_id: ids.correlation,
  operation_id: ids.operation,
  payload_schema_version: "1.0.0",
  idempotency_key: "reservation-test-001",
};

describe("original POS IPC reservation contracts", () => {
  it("routes create/release without accepting caller identity", () => {
    const create = {
      ...base,
      message_type: "inventory.reservation.create",
      payload: {
        presentation_id: ids.presentation,
        quantity: "1.500000",
        reference_id: "manual-hold-1",
        expires_at: "2026-09-07T12:00:00.000Z",
      },
    };
    const release = {
      ...base,
      message_type: "inventory.reservation.release",
      idempotency_key: "reservation-release-001",
      payload: {
        reservation_id: ids.reservation,
        reason_code: "HOLD_CANCELLED",
      },
    };
    expect(InventoryReservationCreateRequestSchema.safeParse(create).success).toBe(true);
    expect(IpcRequestSchema.safeParse(create).success).toBe(true);
    expect(IpcRequestSchema.safeParse({ ...create, company_id: ids.presentation }).success).toBe(false);
    expect(InventoryReservationReleaseRequestSchema.safeParse(release).success).toBe(true);
    expect(IpcRequestSchema.safeParse(release).success).toBe(true);
    expect(IpcRequestSchema.safeParse({
      ...release, payload: { ...release.payload, reason_code: "bad-reason" },
    }).success).toBe(false);
  });
});
