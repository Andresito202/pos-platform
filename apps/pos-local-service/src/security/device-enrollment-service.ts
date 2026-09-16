import { createHash } from "node:crypto";
import {
  DeviceEnrollmentActivationSchema,
  DeviceEnrollmentRequestSchema,
  DeviceEnrollmentResultSchema,
  type DeviceEnrollmentActivation,
  type DeviceEnrollmentRequest,
  type DeviceEnrollmentResult,
} from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { DeviceIdentity } from "./device-identity.js";

export type EnrollmentDecision =
  | "READY"
  | "ALREADY_ENROLLED"
  | "PENDING"
  | "ACTIVATION_REVOKED"
  | "ACTIVATION_EXPIRED"
  | "BINDING_MISMATCH"
  | "ACTIVATION_SECRET_INVALID";

export interface DeviceEnrollmentBinding {
  readonly tenantId: string;
  readonly companyId: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface EnrollmentPreparation {
  readonly decision: EnrollmentDecision;
  readonly request: DeviceEnrollmentRequest | null;
}

function activationFingerprint(activationId: string): string {
  return createHash("sha256").update(`device-enrollment:${activationId}`).digest("hex");
}

function activationSubject(activationId: string): string {
  return `ENROLLMENT:${activationFingerprint(activationId)}`;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

/**
 * Local half of D-3 enrollment.
 *
 * It deliberately does not issue a device credential. The central authority
 * remains the issuer. This component validates a one-time activation envelope,
 * binds it to the local installation/device identity, creates the canonical
 * enrollment request, and records the lifecycle in the append-only security
 * audit. The activation secret is never persisted.
 */
export class DeviceEnrollmentService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly identity: DeviceIdentity,
    private readonly binding: DeviceEnrollmentBinding,
    private readonly now: () => Date = () => new Date(),
  ) {}

  prepare(activationInput: unknown): EnrollmentPreparation {
    const activation = DeviceEnrollmentActivationSchema.parse(activationInput);
    const current = this.now();
    const at = current.getTime();

    if (activation.tenant_id !== this.binding.tenantId
      || activation.company_id !== this.binding.companyId
      || activation.installation_id !== this.binding.installationId
      || activation.device_id !== this.binding.deviceId) {
      return { decision: "BINDING_MISMATCH", request: null };
    }

    if (activation.status === "REVOKED") {
      return { decision: "ACTIVATION_REVOKED", request: null };
    }
    if (activation.status === "EXPIRED" || at >= Date.parse(activation.expires_at)) {
      return { decision: "ACTIVATION_EXPIRED", request: null };
    }

    const subject = activationSubject(activation.activation_id);
    const history = this.database.native.prepare(
      "SELECT event_type,details_json FROM local_security_audit WHERE subject_id=? ORDER BY sequence",
    ).all(subject) as Array<{ event_type: string; details_json: string }>;

    if (history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_COMPLETED")) {
      return { decision: "ALREADY_ENROLLED", request: null };
    }
    if (history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_PENDING")) {
      return { decision: "PENDING", request: null };
    }

    const request = DeviceEnrollmentRequestSchema.parse({
      activation_id: activation.activation_id,
      activation_secret: activation.activation_secret,
      tenant_id: this.binding.tenantId,
      company_id: this.binding.companyId,
      installation_id: this.binding.installationId,
      device_id: this.binding.deviceId,
      device_key_id: this.identity.deviceKeyId(),
      device_public_key_pem: this.identity.publicKeyPem(),
      requested_at: nowIso(this.now),
      version: 1,
    });

    this.database.native.prepare(
      "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
    ).run(
      "DEVICE_ENROLLMENT_PENDING",
      subject,
      JSON.stringify({
        activation_id: activation.activation_id,
        device_key_id: request.device_key_id,
        binding: {
          tenant_id: this.binding.tenantId,
          company_id: this.binding.companyId,
          installation_id: this.binding.installationId,
          device_id: this.binding.deviceId,
        },
      }),
      nowIso(this.now),
    );

    return { decision: "READY", request };
  }

  complete(resultInput: unknown): DeviceEnrollmentResult {
    const result = DeviceEnrollmentResultSchema.parse(resultInput);
    const subject = activationSubject(result.activation_id);
    const history = this.database.native.prepare(
      "SELECT event_type FROM local_security_audit WHERE subject_id=? ORDER BY sequence",
    ).all(subject) as Array<{ event_type: string }>;

    if (history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_COMPLETED")) {
      throw new Error("device enrollment activation has already been consumed");
    }
    if (!history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_PENDING")) {
      throw new Error("device enrollment result has no matching pending request");
    }

    if (result.status !== "ENROLLED" || result.credential_id === null) {
      this.database.native.prepare(
        "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
      ).run(
        "DEVICE_ENROLLMENT_REJECTED",
        subject,
        JSON.stringify({ reason: result.reason }),
        nowIso(this.now),
      );
      throw new Error(`device enrollment rejected${result.reason ? `: ${result.reason}` : ""}`);
    }

    this.database.native.prepare(
      "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
    ).run(
      "DEVICE_ENROLLMENT_COMPLETED",
      subject,
      JSON.stringify({
        activation_id: result.activation_id,
        credential_id: result.credential_id,
        enrolled_at: result.enrolled_at,
      }),
      nowIso(this.now),
    );

    return result;
  }
}
