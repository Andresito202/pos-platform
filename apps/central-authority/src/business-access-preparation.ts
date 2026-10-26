import {
  PostgresBusinessSessionAccessRepository,PostgresDeviceProofReplayVerifier,PostgresBusinessSsaSequenceAllocator,
  PostgresBusinessSessionRevocationTransaction,
  type BusinessAccessValidationPolicy,type DeviceProofRequest,type TrustedBusinessSessionBinding,type createPostgresPool,
  assertCommercialDeployment,type PostgresCommercialDeploymentContext,
} from "@pos-platform/database-postgres";
import { BusinessSessionAuthority } from "./business-session-authority.js";
import type { TrustedSessionAssertionIssuance } from "./central-session-assertion-issuer.js";
import { IsolatedBusinessAccessTokenCodec,CommercialBusinessAccessAuthority } from "./isolated-business-access-token-codec.js";
import type {CommercialAccessClaims} from "@pos-platform/contracts";

/** In-process preparation reference, NOT an access token or a transport contract. */
export interface BusinessAccessPreparationReference { readonly kind:"BUSINESS_ACCESS_PREPARATION" }
export type PreparedBusinessAssertionReservation=Pick<TrustedSessionAssertionIssuance,"reservation"> & {access?:CommercialAccessClaims};

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
    readonly deploymentContext?:PostgresCommercialDeploymentContext,
  ) {
    if(deploymentContext){assertCommercialDeployment(pool,deploymentContext);if(policy.mode!=="PRODUCTION")throw Error("BUSINESS_ACCESS_DEPLOYMENT_POLICY_REQUIRED");}
    else if (policy?.mode!=="ISOLATED_VALIDATION") throw new Error("BUSINESS_ACCESS_PRODUCTION_BLOCKED_PENDING_D3");
    if (!(authority instanceof BusinessSessionAuthority)) throw new Error("BUSINESS_ACCESS_TRUSTED_AUTHORITY_REQUIRED");
    const endpoint=new URL(pool.options.connectionString??"invalid:");
    if (!deploymentContext&&(!["127.0.0.1","localhost"].includes(endpoint.hostname) || endpoint.port!=="55433")) {
      throw new Error("BUSINESS_ACCESS_LOCAL_VALIDATION_SERVER_REQUIRED");
    }
    this.sessions=new PostgresBusinessSessionAccessRepository(pool,policy);
    this.devices=new PostgresDeviceProofReplayVerifier(pool);
    this.sequences=new PostgresBusinessSsaSequenceAllocator(pool,policy.maximumReauthenticationAgeMs);
  }

  private async requireIsolatedDatabase():Promise<void> {
    if(this.deploymentContext){assertCommercialDeployment(this.pool,this.deploymentContext);return;}
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

  /** Local reference is invalidated synchronously even if persistence fails.
   * Only this instance's own reference can request logout, never a session UUID.
   * Failure leaves the durable transaction rolled back and requires fresh auth;
   * it must not be reported as successful remote revocation by a future host.
   */
  async close(reference:unknown,correlationId:string):Promise<"REVOKED"|"ALREADY_REVOKED"|null> {
    const context=this.context(reference);
    if (!context) return null;
    this.contexts.delete(reference as object);
    await this.requireIsolatedDatabase();
    return new PostgresBusinessSessionRevocationTransaction(this.pool).revokeOwn(context,correlationId);
  }

  /** Post-code-exchange composition, ISOLATED_VALIDATION only. Neither a UUID,
   * browser cookie nor serialized claims can substitute for the signed access.
   * The device proof must be fresh and bound to the SAME credential as access.
   * This reserves a watermark; it does not issue SSA or authorization grants. */
  async prepareSequenceFromAccess(accessToken: string, request: DeviceProofRequest,
    codec: IsolatedBusinessAccessTokenCodec|CommercialBusinessAccessAuthority): Promise<PreparedBusinessAssertionReservation | null> {
    await this.requireIsolatedDatabase();
    if(codec instanceof CommercialBusinessAccessAuthority){
      const access=await codec.verifyAndConsume(accessToken,request,"SESSION_ASSERTION");if(!access)return null;
      let body:unknown;try{body=JSON.parse(request.body);}catch{return null;}
      if(!body||typeof body!=="object"||Object.keys(body).length!==1||!("session_id" in body)||body.session_id!==access.sid)return null;
      const reservation=await this.sequences.reserveForVerifiedProof({sessionId:access.sid,deviceId:access.did,installationId:access.iid});
      if(!reservation||reservation.eligibleScope.userId!==access.sub||reservation.eligibleScope.tenantId!==access.tid||
        reservation.eligibleScope.tenantMembershipId!==access.mid)return null;
      return Object.freeze({reservation,access});
    }
    if (!(codec instanceof IsolatedBusinessAccessTokenCodec)) throw Error("BUSINESS_ACCESS_VERIFIER_REQUIRED");
    const access = await codec.verify(accessToken);
    if (!access) return null;
    const context = await this.sessions.findCurrentForVerifiedIdentity({
      sessionId: access.sid, userId: access.sub, tenantId: access.tid, tenantMembershipId: access.mid,
    });
    if (!context) return null;
    const prepared = await this.prepareCurrentSequence(context, request, { deviceId: access.did, credentialId: access.cid });
    // Revocation, expiry and credential state are checked again after durable
    // reservation. Failure leaves a gap, never restores the nonce/watermark.
    if (!prepared || !await codec.verify(accessToken)) return null;
    return prepared;
  }

  async prepareSequence(reference:unknown,request:DeviceProofRequest):Promise<PreparedBusinessAssertionReservation|null> {
    const context=this.context(reference);
    if (!context) return null;
    // Burn preparation synchronously. A denied request, later error or process
    // restart cannot reconstruct this reference from a sessionId.
    this.contexts.delete(reference as object);
    await this.requireIsolatedDatabase();
    return this.prepareCurrentSequence(context, request);
  }

  private async prepareCurrentSequence(context: TrustedBusinessSessionBinding, request: DeviceProofRequest,
    expectedDevice?: { deviceId: string; credentialId: string }): Promise<PreparedBusinessAssertionReservation | null> {
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
    if (expectedDevice && (device.deviceId!==expectedDevice.deviceId || device.credentialId!==expectedDevice.credentialId)) return null;
    if (!(await this.sessions.findCurrent(context))) return null;
    const reservation=await this.sequences.reserveForVerifiedProof({
      sessionId:context.sessionId,deviceId:device.deviceId,installationId:device.installationId,
    });
    if (!reservation || reservation.eligibleScope.userId!==context.userId
      || reservation.eligibleScope.tenantId!==device.tenantId
      || reservation.eligibleScope.companyId!==device.companyId
      || (expectedDevice && Date.parse(reservation.eligibleScope.deviceCredentialExpiresAt)>Date.parse(device.credentialExpiresAt))
      || !(await this.sessions.findCurrent(context))) return null;
    // Device nonce and sequence are already committed independently by their
    // canonical owners. Subsequent failure burns the nonce / leaves a sequence
    // gap; it MUST NOT restore either or sign a stale result.
    return Object.freeze({reservation});
  }
}
