import type { BusinessSessionValidationPolicy, createPostgresPool } from "@pos-platform/database-postgres";
import { BusinessInitialMfaFlow } from "./business-initial-mfa-flow.js";
import { BusinessSessionAuthority } from "./business-session-authority.js";
import { BusinessAccessPreparation } from "./business-access-preparation.js";

/** Supplied by a trusted central host, never by a request or React. A real
 * implementation must enforce its approved durable abuse policy. No default.
 */
export interface BusinessLoginAttemptControl {
  readonly policyReference: string;
  assertAllowed(phase: "PASSWORD_AND_MFA_BEGIN" | "MFA_AND_SESSION_COMPLETE"): Promise<void>;
}

/** Composes the already implemented password/MFA/session coordinators.
 * It deliberately retains their hard isolated-validation production gate.
 * No HTTP login, serialized proof, token profile or client-held password state.
 */
export class BusinessLoginCoordinator {
  private readonly mfa: BusinessInitialMfaFlow;
  private readonly access: BusinessAccessPreparation;
  constructor(
    pool: ReturnType<typeof createPostgresPool>,
    mfaPolicy: ConstructorParameters<typeof BusinessInitialMfaFlow>[1],
    sessionPolicy: BusinessSessionValidationPolicy,
    accessPolicy: ConstructorParameters<typeof BusinessAccessPreparation>[2],
    private readonly attempts: BusinessLoginAttemptControl,
  ) {
    if (!attempts?.policyReference?.trim() || typeof attempts.assertAllowed !== "function") throw new Error("BUSINESS_LOGIN_ATTEMPT_CONTROL_REQUIRED");
    this.mfa = new BusinessInitialMfaFlow(pool, mfaPolicy);
    const authority = new BusinessSessionAuthority(pool, this.mfa, sessionPolicy);
    this.access = new BusinessAccessPreparation(pool, authority, accessPolicy);
  }
  async begin(input: Parameters<BusinessInitialMfaFlow["begin"]>[0]) {
    await this.attempts.assertAllowed("PASSWORD_AND_MFA_BEGIN");
    return this.mfa.begin(input);
  }
  async complete(input: Parameters<BusinessInitialMfaFlow["complete"]>[0], selection: Parameters<BusinessSessionAuthority["create"]>[0]["selection"]) {
    await this.attempts.assertAllowed("MFA_AND_SESSION_COMPLETE");
    const mfaReceipt = await this.mfa.complete(input);
    return mfaReceipt === null ? null : this.access.open({ mfaReceipt, selection });
  }
  resolveCurrent(reference: unknown) { return this.access.resolveCurrent(reference); }
  close(reference: unknown, correlationId: string) { return this.access.close(reference, correlationId); }
  prepareSequence(reference: unknown, request: Parameters<BusinessAccessPreparation["prepareSequence"]>[1]) {
    return this.access.prepareSequence(reference, request);
  }
}
