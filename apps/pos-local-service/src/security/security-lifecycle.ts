import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { LicenseVerificationResult } from "./license-verifier.js";

export type DeviceKeyLifecycleStatus = "ACTIVE" | "VERIFY_ONLY" | "REVOKED" | "REPLACED";
export type LicenseActivationStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";
export type CapabilityDecision =
  | "ALLOW"
  | "LICENSE_INVALID"
  | "LICENSE_NOT_ACTIVATED"
  | "LICENSE_SUSPENDED"
  | "LICENSE_REVOKED"
  | "DEVICE_KEY_INACTIVE"
  | "ENTITLEMENT_MISSING";

interface DeviceKeyRow {
  device_key_id: string;
  generation: number;
  secret_name: string;
  status: DeviceKeyLifecycleStatus;
}

interface ActivationRow {
  license_id: string;
  device_key_id: string;
  status: LicenseActivationStatus;
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function assertReason(reason: string): void {
  if (!reason.trim() || reason.length > 512) throw new Error("security lifecycle reason is required");
}

export class LocalSecurityLifecycle {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  registerInitialDeviceKey(deviceKeyId: string, secretName = "device-identity"): void {
    const existing = this.database.native.prepare(
      "SELECT active_key_id FROM local_device_identity_state WHERE singleton = 1",
    ).get() as { active_key_id: string } | undefined;
    if (existing) {
      if (existing.active_key_id !== deviceKeyId) throw new Error("active device identity already registered");
      return;
    }

    const createdAt = nowIso(this.now);
    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "INSERT INTO local_device_key_history(device_key_id,generation,secret_name,status,created_at,retired_at) VALUES (?,?,?,?,?,NULL)",
      ).run(deviceKeyId, 1, secretName, "ACTIVE", createdAt);
      this.database.native.prepare(
        "INSERT INTO local_device_identity_state(singleton,active_key_id,generation,status) VALUES (1,?,?,?)",
      ).run(deviceKeyId, 1, "ACTIVE");
      this.audit("DEVICE_KEY_REGISTERED", deviceKeyId, { generation: 1 });
    });
    transaction();
  }

  rotateDeviceKey(newDeviceKeyId: string, secretName: string): void {
    const current = this.currentDeviceKey();
    const createdAt = nowIso(this.now);
    const nextGeneration = current.generation + 1;
    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "UPDATE local_device_key_history SET status='VERIFY_ONLY', retired_at=? WHERE device_key_id=? AND status='ACTIVE'",
      ).run(createdAt, current.device_key_id);
      this.database.native.prepare(
        "INSERT INTO local_device_key_history(device_key_id,generation,secret_name,status,created_at,retired_at) VALUES (?,?,?,?,?,NULL)",
      ).run(newDeviceKeyId, nextGeneration, secretName, "ACTIVE", createdAt);
      this.database.native.prepare(
        "UPDATE local_device_identity_state SET active_key_id=?, generation=?, status='ACTIVE' WHERE singleton=1",
      ).run(newDeviceKeyId, nextGeneration);
      this.audit("DEVICE_KEY_ROTATED", newDeviceKeyId, {
        previous_device_key_id: current.device_key_id,
        generation: nextGeneration,
      });
    });
    transaction();
  }

  replaceDeviceKey(newDeviceKeyId: string, secretName: string, reason: string): void {
    assertReason(reason);
    const current = this.currentDeviceKey();
    const createdAt = nowIso(this.now);
    const nextGeneration = current.generation + 1;
    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "UPDATE local_device_key_history SET status='REPLACED', retired_at=? WHERE device_key_id=?",
      ).run(createdAt, current.device_key_id);
      this.database.native.prepare(
        "UPDATE local_license_activation_state SET status='REVOKED', updated_at=?, reason=? WHERE device_key_id=? AND status!='REVOKED'",
      ).run(createdAt, "DEVICE_REPLACED", current.device_key_id);
      this.database.native.prepare(
        "INSERT INTO local_device_key_history(device_key_id,generation,secret_name,status,created_at,retired_at) VALUES (?,?,?,?,?,NULL)",
      ).run(newDeviceKeyId, nextGeneration, secretName, "ACTIVE", createdAt);
      this.database.native.prepare(
        "UPDATE local_device_identity_state SET active_key_id=?, generation=?, status='ACTIVE' WHERE singleton=1",
      ).run(newDeviceKeyId, nextGeneration);
      this.audit("DEVICE_KEY_REPLACED", newDeviceKeyId, {
        previous_device_key_id: current.device_key_id,
        reason,
        generation: nextGeneration,
      });
    });
    transaction();
  }

  revokeDeviceKey(deviceKeyId: string, reason: string): void {
    assertReason(reason);
    const at = nowIso(this.now);
    const row = this.database.native.prepare(
      "SELECT status FROM local_device_key_history WHERE device_key_id=?",
    ).get(deviceKeyId) as { status: DeviceKeyLifecycleStatus } | undefined;
    if (!row) throw new Error("device key not found");
    if (row.status === "REVOKED") return;

    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "UPDATE local_device_key_history SET status='REVOKED', retired_at=COALESCE(retired_at,?) WHERE device_key_id=?",
      ).run(at, deviceKeyId);
      this.database.native.prepare(
        "UPDATE local_license_activation_state SET status='REVOKED', updated_at=?, reason=? WHERE device_key_id=? AND status!='REVOKED'",
      ).run(at, "DEVICE_KEY_REVOKED", deviceKeyId);
      const active = this.database.native.prepare(
        "SELECT active_key_id FROM local_device_identity_state WHERE singleton=1",
      ).get() as { active_key_id: string } | undefined;
      if (active?.active_key_id === deviceKeyId) {
        this.database.native.prepare(
          "UPDATE local_device_identity_state SET status='REVOKED' WHERE singleton=1",
        ).run();
      }
      this.audit("DEVICE_KEY_REVOKED", deviceKeyId, { reason });
    });
    transaction();
  }

  activateLicense(result: LicenseVerificationResult): void {
    if (!result.claims || !["VALID", "VALID_OFFLINE_GRACE"].includes(result.decision)) {
      throw new Error("license must be cryptographically valid before activation");
    }
    const active = this.currentDeviceKey();
    if (active.status !== "ACTIVE") throw new Error("active device key is not usable");
    const at = nowIso(this.now);
    this.database.native.prepare(
      `INSERT INTO local_license_activation_state(license_id,device_key_id,status,activated_at,updated_at,reason)
       VALUES (?,?, 'ACTIVE', ?, ?, NULL)
       ON CONFLICT(license_id) DO UPDATE SET
         device_key_id=excluded.device_key_id,
         status='ACTIVE',
         updated_at=excluded.updated_at,
         reason=NULL`,
    ).run(result.claims.license_id, active.device_key_id, at, at);
    this.audit("LICENSE_ACTIVATED", result.claims.license_id, {
      device_key_id: active.device_key_id,
      decision: result.decision,
    });
  }

  suspendLicense(licenseId: string, reason: string): void {
    this.transitionLicense(licenseId, "SUSPENDED", reason, "LICENSE_SUSPENDED");
  }

  revokeLicense(licenseId: string, reason: string): void {
    this.transitionLicense(licenseId, "REVOKED", reason, "LICENSE_REVOKED");
  }

  capabilityDecision(
    capability: string,
    verification: LicenseVerificationResult,
  ): CapabilityDecision {
    if (!verification.claims || !["VALID", "VALID_OFFLINE_GRACE"].includes(verification.decision)) {
      return "LICENSE_INVALID";
    }

    const activation = this.database.native.prepare(
      "SELECT license_id,device_key_id,status FROM local_license_activation_state WHERE license_id=?",
    ).get(verification.claims.license_id) as ActivationRow | undefined;
    if (!activation) return "LICENSE_NOT_ACTIVATED";
    if (activation.status === "SUSPENDED") return "LICENSE_SUSPENDED";
    if (activation.status === "REVOKED") return "LICENSE_REVOKED";

    const key = this.database.native.prepare(
      "SELECT status FROM local_device_key_history WHERE device_key_id=?",
    ).get(activation.device_key_id) as { status: DeviceKeyLifecycleStatus } | undefined;
    if (!key || key.status !== "ACTIVE") return "DEVICE_KEY_INACTIVE";
    if (!verification.claims.entitlements.includes(capability)) return "ENTITLEMENT_MISSING";
    return "ALLOW";
  }

  auditEntries(): readonly unknown[] {
    return this.database.native.prepare(
      "SELECT sequence,event_type,subject_id,details_json,created_at FROM local_security_audit ORDER BY sequence",
    ).all();
  }

  private currentDeviceKey(): DeviceKeyRow {
    const row = this.database.native.prepare(
      `SELECT h.device_key_id,h.generation,h.secret_name,h.status
         FROM local_device_identity_state s
         JOIN local_device_key_history h ON h.device_key_id=s.active_key_id
        WHERE s.singleton=1`,
    ).get() as DeviceKeyRow | undefined;
    if (!row) throw new Error("device identity is not registered");
    return row;
  }

  private transitionLicense(
    licenseId: string,
    status: Exclude<LicenseActivationStatus, "ACTIVE">,
    reason: string,
    eventType: string,
  ): void {
    assertReason(reason);
    const at = nowIso(this.now);
    const result = this.database.native.prepare(
      "UPDATE local_license_activation_state SET status=?, updated_at=?, reason=? WHERE license_id=?",
    ).run(status, at, reason, licenseId);
    if (result.changes !== 1) throw new Error("license activation not found");
    this.audit(eventType, licenseId, { reason });
  }

  private audit(eventType: string, subjectId: string, details: unknown): void {
    this.database.native.prepare(
      "INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at) VALUES (?,?,?,?)",
    ).run(eventType, subjectId, JSON.stringify(details), nowIso(this.now));
  }
}
