import {
  PostgresBusinessSessionAccessRepository,PostgresDeviceProofReplayVerifier,PostgresBusinessSsaSequenceAllocator,
  type BusinessAccessValidationPolicy,type DeviceProofRequest,type TrustedBusinessSessionBinding,type createPostgresPool,
} from "@pos-platform/database-postgres";
import { BusinessSessionAuthority } from "./business-session-authority.js";
import type { TrustedSessionAssertionIssuance } from "./central-session-assertion-issuer.js";

/** In-process preparation reference, NOT an access token or a transport contract. */
export interface BusinessAccessPreparationReference { readonly kind:"BUSINESS_ACCESS_PREPARATION" }
export type PreparedBusinessAssertionReservation=Pick<TrustedSessionAssertionIssuance,"reservation">;

/**
 * Isolated preparation of the existing issuer's reservation input. No external
 * access protocol is implemented. Claims, permissions and signing remain absent.
 */
export class BusinessAccessPreparation {
  private readonly contexts=new WeakMap<object,TrustedBusinessSessionBinding>();
  private readonly sessions;
  private readonly devices;
  private readonly sequences;
  constructor(
    private readonly pool:ReturnType<typeof createPostgresPool>,
    private readonly authority:BusinessSessionAuthority,
    policy:BusinessAccessValidationPolicy & {readonly mode:"ISOLATED_VALIDATION"|"PRODUCTION"},
  ) {
    if (policy?.mode!=="ISOLATED_VALIDATION") throw new Error("BUSINESS_ACCESS_PRODUCTION_BLOCKED_PENDING_D3");
    if (!(authority instanceof BusinessSessionAuthority)) throw new Error("BUSINESS_ACCESS_TRUSTED_AUTHORITY_REQUIRED");
    const endpoint=new URL(pool.options.connectionString??"invalid:");
    if (!["127.0.0.1","localhost"].includes(endpoint.hostname) || endpoint.port!=="55433") {
      throw new Error("BUSINESS_ACCESS_LOCAL_VALIDATION_SERVER_REQUIRED");
    }
    this.sessions=new PostgresBusinessSessionAccessRepository(pool,policy);
    this.devices=new PostgresDeviceProofReplayVerifier(pool);
    this.sequences=new PostgresBusinessSsaSequenceAllocator(pool,policy.maximumReauthenticationAgeMs);
  }

  private async requireIsolatedDatabase():Promise<void> {
    const result=await this.pool.query<{allowed:boolean}>(
      "SELECT current_database() ~ '^pos_business_session_test_[0-9a-f]{16}$' AS allowed");
    if (result.rows[0]?.allowed!==true) throw new Error("BUSINESS_ACCESS_ISOLATED_DATABASE_REQUIRED");
  }

  async open(input:Parameters<BusinessSessionAuthority["create"]>[0]):Promise<BusinessAccessPreparationReference|null> {
    await this.requireIsolatedDatabase();
    const session=await this.authority.create(input);
    if (!session) return null;
    const reference=Object.freeze({kind:"BUSINESS_ACCESS_PREPARATION" as const});
    this.contexts.set(reference,Object.freeze({
      sessionId:session.sessionId,userId:session.userId,tenantId:session.tenantId,
      tenantMembershipId:session.tenantMembershipId,authenticatedAt:session.authenticatedAt,expiresAt:session.expiresAt,
    }));
    return reference;
  }

  private context(reference:unknown):TrustedBusinessSessionBinding|null {
    return typeof reference==="object" && reference!==null ? this.contexts.get(reference)??null : null;
  }

  /** Internal inspection only, no possession inferred from the returned IDs. */
  async resolveCurrent(reference:unknown):Promise<TrustedBusinessSessionBinding|null> {
    const context=this.context(reference);
    return context ? this.sessions.findCurrent(context) : null;
  }

  async prepareSequence(reference:unknown,request:DeviceProofRequest):Promise<PreparedBusinessAssertionReservation|null> {
    const context=this.context(reference);
    if (!context) return null;
    // Burn preparation synchronously. A denied request, later error or process
    // restart cannot reconstruct this reference from a sessionId.
    this.contexts.delete(reference as object);
    await this.requireIsolatedDatabase();
    if (typeof request.body!=="string" || Buffer.byteLength(request.body,"utf8")>16*1024) return null;
    if (!(await this.sessions.findCurrent(context))) return null;
    // Internal validation profile: session_id is only a selector bound to the
    // original context. This is NOT an approved HTTP/access-token protocol.
    // Verify the exact signed body; never reconstruct bytes before verification.
    let body:unknown;
    try { body=JSON.parse(request.body); } catch { return null; }
    if (!body || typeof body!=="object" || Array.isArray(body)
      || Object.keys(body).length!==1 || !("session_id" in body) || body.session_id!==context.sessionId) return null;
    const device=await this.devices.verifyAndConsume(request);
    if (!device || device.tenantId!==context.tenantId) return null;
    if (!(await this.sessions.findCurrent(context))) return null;
    const reservation=await this.sequences.reserveForVerifiedProof({
      sessionId:context.sessionId,deviceId:device.deviceId,installationId:device.installationId,
    });
    if (!reservation || reservation.eligibleScope.userId!==context.userId
      || reservation.eligibleScope.tenantId!==device.tenantId
      || reservation.eligibleScope.companyId!==device.companyId
      || !(await this.sessions.findCurrent(context))) return null;
    // Device nonce and sequence are already committed independently by their
    // canonical owners. Subsequent failure burns the nonce / leaves a sequence
    // gap; it MUST NOT restore either or sign a stale result.
    return Object.freeze({reservation});
  }
}
