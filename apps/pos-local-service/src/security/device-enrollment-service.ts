import { createHash } from "node:crypto";
import {
  DeviceEnrollmentActivationSchema,
  DeviceEnrollmentRequestSchema,
  DeviceEnrollmentResultSchema,
  type DeviceEnrollmentResult,
} from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { DeviceIdentity } from "./device-identity.js";
import type { DeviceTrustCredentialStore } from "./device-trust-credential-store.js";
import {
  canonicalDeviceTrustJson,
  createEnrollmentChallenge,
  type DeviceTrustVerifier,
} from "@pos-platform/device-trust";

export type EnrollmentDecision =
  | "READY" | "ALREADY_ENROLLED" | "PENDING" | "ACTIVATION_REVOKED"
  | "ACTIVATION_EXPIRED" | "BINDING_MISMATCH" | "ACTIVATION_SECRET_INVALID";

export interface DeviceEnrollmentBinding {
  readonly tenantId: string;
  readonly companyId: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface EnrollmentPreparation {
  readonly decision: EnrollmentDecision;
  readonly request: ReturnType<typeof DeviceEnrollmentRequestSchema.parse> | null;
}

function activationFingerprint(activationId: string): string {
  return createHash("sha256").update(`device-enrollment:${activationId}`).digest("hex");
}
function activationSubject(activationId: string): string { return `ENROLLMENT:${activationFingerprint(activationId)}`; }
function nowIso(now: () => Date): string { return now().toISOString(); }

export class DeviceEnrollmentService {
  constructor(
    private readonly database: LocalDatabase,
    private readonly identity: DeviceIdentity,
    private readonly binding: DeviceEnrollmentBinding,
    private readonly credentialStore?: DeviceTrustCredentialStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  prepare(activationInput: unknown): EnrollmentPreparation {
    const activation = DeviceEnrollmentActivationSchema.parse(activationInput);
    const current = this.now();
    if (activation.tenant_id !== this.binding.tenantId || activation.company_id !== this.binding.companyId
      || activation.installation_id !== this.binding.installationId || activation.device_id !== this.binding.deviceId) {
      return { decision: "BINDING_MISMATCH", request: null };
    }
    if (activation.status === "REVOKED") return { decision: "ACTIVATION_REVOKED", request: null };
    if (activation.status === "EXPIRED" || current.getTime() >= Date.parse(activation.expires_at)) {
      return { decision: "ACTIVATION_EXPIRED", request: null };
    }

    if (this.credentialStore?.has()) return { decision: "ALREADY_ENROLLED", request: null };

    const subject = activationSubject(activation.activation_id);
    const history = this.database.native.prepare(
      "SELECT event_type FROM local_security_audit WHERE subject_id=? ORDER BY sequence",
    ).all(subject) as Array<{ event_type: string }>;
    if (history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_COMPLETED")) return { decision: "ALREADY_ENROLLED", request: null };
    if (history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_PENDING")) return { decision: "PENDING", request: null };

    const issuedAt = nowIso(this.now);
    const challengeExpiresAt = new Date(Math.min(Date.parse(activation.expires_at), current.getTime() + 5 * 60 * 1000)).toISOString();
    const challenge = createEnrollmentChallenge({
      tenant_id: this.binding.tenantId,
      installation_id: this.binding.installationId,
      device_id: this.binding.deviceId,
      issued_at: issuedAt,
      expires_at: challengeExpiresAt,
    });
    const proofSignature = this.identity.signChallenge(Buffer.from(canonicalDeviceTrustJson(challenge))).toString("base64url");
    const request = DeviceEnrollmentRequestSchema.parse({
      activation_id: activation.activation_id,
      activation_secret: activation.activation_secret,
      tenant_id: this.binding.tenantId,
      company_id: this.binding.companyId,
      installation_id: this.binding.installationId,
      device_id: this.binding.deviceId,
      device_key_id: this.identity.deviceKeyId(),
      device_public_key_pem: this.identity.publicKeyPem(),
      challenge,
      proof: { challenge_id: challenge.challenge_id, device_key_id: this.identity.deviceKeyId(), signature: proofSignature },
      requested_at: issuedAt,
      version: 1,
    });

    this.database.native.prepare(
      "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
    ).run("DEVICE_ENROLLMENT_PENDING", subject, JSON.stringify({
      activation_id: activation.activation_id,
      device_key_id: request.device_key_id,
      challenge_id: challenge.challenge_id,
      binding: { tenant_id: this.binding.tenantId, company_id: this.binding.companyId, installation_id: this.binding.installationId, device_id: this.binding.deviceId },
    }), issuedAt);
    return { decision: "READY", request };
  }

  complete(resultInput: unknown, verifier: DeviceTrustVerifier): DeviceEnrollmentResult {
    const result = DeviceEnrollmentResultSchema.parse(resultInput);
    const subject = activationSubject(result.activation_id);
    const history = this.database.native.prepare(
      "SELECT event_type FROM local_security_audit WHERE subject_id=? ORDER BY sequence",
    ).all(subject) as Array<{ event_type: string }>;
    if (history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_COMPLETED") || this.credentialStore?.has()) {
      throw new Error("device enrollment activation has already been consumed");
    }
    if (!history.some((entry) => entry.event_type === "DEVICE_ENROLLMENT_PENDING")) {
      throw new Error("device enrollment result has no matching pending request");
    }
    if (result.status !== "ENROLLED" || result.credential_id === null || result.credential === null) {
      this.database.native.prepare(
        "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
      ).run("DEVICE_ENROLLMENT_REJECTED", subject, JSON.stringify({ reason: result.reason }), nowIso(this.now));
      throw new Error(`device enrollment rejected${result.reason ? `: ${result.reason}` : ""}`);
    }

    const verification = verifier.verifyCredential(result.credential, {
      tenantId: this.binding.tenantId, companyId: this.binding.companyId,
      installationId: this.binding.installationId, deviceId: this.binding.deviceId,
    });
    if (verification.decision !== "VALID") throw new Error(`device enrollment credential rejected: ${verification.decision}`);
    if (!this.credentialStore) throw new Error("DEVICE_TRUST_CREDENTIAL_STORE_UNAVAILABLE");

    // Persist the verified signed object before declaring enrollment complete.
    // The audit event is never the credential store and never contains its value.
    this.credentialStore.save(result.credential);
    this.database.native.prepare(
      "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
    ).run("DEVICE_ENROLLMENT_COMPLETED", subject, JSON.stringify({
      activation_id: result.activation_id, credential_id: result.credential_id, enrolled_at: result.enrolled_at,
    }), nowIso(this.now));
    return result;
  }
}
