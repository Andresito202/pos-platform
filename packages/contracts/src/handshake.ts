import * as z from "zod";
import {
  ContractVersionSchema,
  StableCodeSchema,
  UuidSchema,
  VersionIdentifierSchema,
} from "./primitives.js";
import {
  ContractVersionRangeSchema,
  compareContractVersions,
  type ContractVersionRange,
} from "./versioning.js";

export const RuntimeHandshakeStatusSchema = z.enum([
  "COMPATIBLE",
  "UPDATE_DESKTOP_REQUIRED",
  "UPDATE_SERVICE_REQUIRED",
  "MIGRATION_REQUIRED",
  "RECOVERY_REQUIRED",
  "UNTRUSTED_INSTALLATION",
]);

export const RuntimeCompatibilitySnapshotSchema = z.strictObject({
  desktop_version: ContractVersionSchema,
  service_version: ContractVersionSchema,
  protocol_min: ContractVersionSchema,
  protocol_max: ContractVersionSchema,
  installation_id: UuidSchema,
  device_id: UuidSchema,
  schema_version: VersionIdentifierSchema,
  service_state: StableCodeSchema,
}).superRefine((snapshot, context) => {
  if (compareContractVersions(snapshot.protocol_min, snapshot.protocol_max) > 0) {
    context.addIssue({
      code: "custom",
      path: ["protocol_max"],
      message: "protocol_max must be greater than or equal to protocol_min",
    });
  }
});

export const RuntimeHandshakeOutcomeSchema = z.strictObject({
  status: RuntimeHandshakeStatusSchema,
  negotiated_protocol_version: ContractVersionSchema.nullable(),
}).superRefine((outcome, context) => {
  if (outcome.status === "COMPATIBLE" && outcome.negotiated_protocol_version === null) {
    context.addIssue({
      code: "custom",
      path: ["negotiated_protocol_version"],
      message: "COMPATIBLE requires a negotiated protocol version",
    });
  }
  if (outcome.status !== "COMPATIBLE" && outcome.negotiated_protocol_version !== null) {
    context.addIssue({
      code: "custom",
      path: ["negotiated_protocol_version"],
      message: "non-compatible outcomes cannot advertise a negotiated protocol version",
    });
  }
});

export type RuntimeHandshakeStatus = z.infer<typeof RuntimeHandshakeStatusSchema>;
export type RuntimeCompatibilitySnapshot = z.infer<typeof RuntimeCompatibilitySnapshotSchema>;
export type RuntimeHandshakeOutcome = z.infer<typeof RuntimeHandshakeOutcomeSchema>;

export function negotiateProtocolVersion(
  localRangeInput: ContractVersionRange,
  remoteRangeInput: ContractVersionRange,
): string | null {
  const localRange = ContractVersionRangeSchema.parse(localRangeInput);
  const remoteRange = ContractVersionRangeSchema.parse(remoteRangeInput);

  const lowerBound = compareContractVersions(localRange.min, remoteRange.min) >= 0
    ? localRange.min
    : remoteRange.min;
  const upperBound = compareContractVersions(localRange.max, remoteRange.max) <= 0
    ? localRange.max
    : remoteRange.max;

  return compareContractVersions(lowerBound, upperBound) <= 0 ? upperBound : null;
}
