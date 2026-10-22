import { PostgresDeviceProofReplayVerifier, type DeviceProofRequest } from "@pos-platform/database-postgres";
import type { createPostgresPool } from "@pos-platform/database-postgres";
import { BusinessAccessPreparation } from "./business-access-preparation.js";
import { CommercialBindingPrerequisite, type TrustedCommercialAudit } from "./commercial-binding-prerequisite.js";

/**
 * The signed request's exact body is a selector only; it cannot authenticate
 * a human session. Device verification consumes the proof and its nonce.
 *
 * ISOLATED_VALIDATION only, using the existing BusinessAccessPreparation
 * production gate and PostgreSQL device trust owner.
 */
export function createIsolatedCommercialBindingPrerequisite(
  preparation: BusinessAccessPreparation,
  pool: ReturnType<typeof createPostgresPool>,
  audit: TrustedCommercialAudit,
): CommercialBindingPrerequisite<DeviceProofRequest> {
  if (!(preparation instanceof BusinessAccessPreparation))
    throw new Error("BUSINESS_ACCESS_TRUSTED_PREPARATION_REQUIRED");
  const verifier = new PostgresDeviceProofReplayVerifier(pool);
  return new CommercialBindingPrerequisite(
    {
      authorityReference: "BUSINESS_ACCESS_PREPARATION_CURRENT",
      inspect: async reference => {
        const current = await preparation.resolveCurrent(reference);
        return current === null ? null : Object.freeze({
          sessionId: current.sessionId,
          userId: current.userId,
          tenantId: current.tenantId,
          tenantMembershipId: current.tenantMembershipId,
        });
      },
    },
    {
      authorityReference: "POSTGRES_DEVICE_PROOF_REPLAY_VERIFIER",
      inspect: async proof => {
        if (!proof || typeof proof.body !== "string" ||
          Buffer.byteLength(proof.body, "utf8") > 16 * 1024) return null;
        let body: unknown;
        try { body = JSON.parse(proof.body); } catch { return null; }
        if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !("session_id" in body) ||
          typeof body.session_id !== "string") return null;
        const device = await verifier.verifyAndConsume(proof);
        return device === null ? null : Object.freeze({
          deviceId: device.deviceId, installationId: device.installationId,
          tenantId: device.tenantId, companyId: device.companyId,
          credentialId: device.credentialId,
        });
      },
    },
    audit,
  );
}
