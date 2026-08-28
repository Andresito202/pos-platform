import { describe, expect, it } from "vitest";
import {
  RuntimeCompatibilitySnapshotSchema,
  RuntimeHandshakeOutcomeSchema,
  RuntimeHandshakeStatusSchema,
  negotiateProtocolVersion,
} from "../src/index.js";

const snapshot = {
  desktop_version: "1.4.0",
  service_version: "1.4.2",
  protocol_min: "1.2.0",
  protocol_max: "1.5.0",
  installation_id: "550e8400-e29b-41d4-a716-446655440010",
  device_id: "550e8400-e29b-41d4-a716-446655440011",
  schema_version: "003",
  service_state: "READY",
};

describe("TECH-003 desktop/local-service handshake contracts", () => {
  it("accepts the canonical compatibility snapshot", () => {
    expect(RuntimeCompatibilitySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("rejects inverted protocol windows", () => {
    expect(RuntimeCompatibilitySnapshotSchema.safeParse({
      ...snapshot,
      protocol_min: "2.0.0",
      protocol_max: "1.9.9",
    }).success).toBe(false);
  });

  it("rejects unknown handshake fields", () => {
    expect(RuntimeCompatibilitySnapshotSchema.safeParse({
      ...snapshot,
      privileged_pipe: true,
    }).success).toBe(false);
  });

  it("negotiates the highest version in the intersection", () => {
    expect(negotiateProtocolVersion(
      { min: "1.0.0", max: "1.4.0" },
      { min: "1.2.0", max: "1.5.0" },
    )).toBe("1.4.0");
  });

  it("returns null when protocol windows do not overlap", () => {
    expect(negotiateProtocolVersion(
      { min: "1.0.0", max: "1.1.0" },
      { min: "1.2.0", max: "1.5.0" },
    )).toBeNull();
  });

  it("keeps the handshake result vocabulary exact", () => {
    expect(RuntimeHandshakeStatusSchema.options).toEqual([
      "COMPATIBLE",
      "UPDATE_DESKTOP_REQUIRED",
      "UPDATE_SERVICE_REQUIRED",
      "MIGRATION_REQUIRED",
      "RECOVERY_REQUIRED",
      "UNTRUSTED_INSTALLATION",
    ]);
  });

  it("requires a negotiated protocol only for COMPATIBLE", () => {
    expect(RuntimeHandshakeOutcomeSchema.safeParse({
      status: "COMPATIBLE",
      negotiated_protocol_version: "1.4.0",
    }).success).toBe(true);
    expect(RuntimeHandshakeOutcomeSchema.safeParse({
      status: "COMPATIBLE",
      negotiated_protocol_version: null,
    }).success).toBe(false);
    expect(RuntimeHandshakeOutcomeSchema.safeParse({
      status: "MIGRATION_REQUIRED",
      negotiated_protocol_version: "1.4.0",
    }).success).toBe(false);
  });
});
