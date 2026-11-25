import { createHash, randomBytes } from "node:crypto";
import { uuidV7, UuidSchema, UuidV7Schema, PlatformSecurityEventCode, type NativeClientRegistration } from "@pos-platform/contracts";
import { PostgresNativeBusinessDeviceProofVerifier, PostgresPlatformSecurityEventRepository, type Pool, type PoolClient, type DeviceProofRequest } from "@pos-platform/database-postgres";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";
import { inspectCommercialHeaders, readCommercialJsonBody, sendCommercialJson } from "./commercial-https-request-boundary.js";

const CHALLENGE = "/v1/commercial/native-request-challenges";
const REGISTER = "/v1/commercial/native-requests";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, "base64url").toString("base64url") === value;
const fields = ["client_id","redirect_uri","code_challenge","code_challenge_method","state"];
type Parameters = { client_id: string; redirect_uri: string; code_challenge: string; code_challenge_method: "S256"; state: string };
function matches(p: Record<string, unknown>, r: NativeClientRegistration): p is Parameters {
  return Object.keys(p).length === fields.length && fields.every(k => Object.hasOwn(p,k)) &&
    p.client_id === r.clientId && p.redirect_uri === r.redirectUri && p.code_challenge_method === "S256" &&
    opaque(p.code_challenge) && typeof p.state === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(p.state);
}
export class NativeBusinessRequestRegistration {
  private readonly proofs: PostgresNativeBusinessDeviceProofVerifier;
  private readonly audit: PostgresPlatformSecurityEventRepository;
  constructor(private readonly pool: Pool, private readonly registration: NativeClientRegistration,
    private readonly policy: Readonly<{challengeMs: number; requestMs: number; challengesPerMinute: number}>) {
    if (registration.platform !== "ANDROID" || ![policy.challengeMs,policy.requestMs,policy.challengesPerMinute].every(n => Number.isSafeInteger(n) && n > 0) ||
      policy.challengeMs > 300000 || policy.requestMs > 300000 || policy.challengesPerMinute > 10000) throw Error("NATIVE_REQUEST_POLICY_REJECTED");
    this.proofs = new PostgresNativeBusinessDeviceProofVerifier(pool);
    this.audit = new PostgresPlatformSecurityEventRepository(pool);
  }
  private async transaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '10s'");
      const value = await work(c);
      await c.query("COMMIT");
      return value;
    } catch (error) { await c.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { c.release(); }
  }
  private async event(c: PoolClient, reason: string, correlation: string) {
    await this.audit.append({user_id:null,session_id:null,tenant_id:null,event_code:PlatformSecurityEventCode.MFA_REQUIRED,
      result:"CHALLENGE_REQUIRED",reason_code:reason,correlation_id:correlation,occurred_at:new Date().toISOString()},c);
  }
  async challenge(p: Record<string,unknown>, correlation: string) {
    if (!matches(p,this.registration)) return null;
    return this.transaction(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["native-challenge:"+p.client_id]);
      const n = await c.query("SELECT count(*)::int AS n FROM identity.native_authorization_requests WHERE client_id=$1 AND created_at>clock_timestamp()-interval '1 minute'",[p.client_id]);
      if (n.rows[0].n >= this.policy.challengesPerMinute) return null;
      const challenge = randomBytes(32).toString("base64url"), id = uuidV7();
      const row = await c.query(`INSERT INTO identity.native_authorization_requests
        (id,challenge_hash,client_id,redirect_uri,code_challenge,state,created_at,challenge_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),clock_timestamp()+($7::bigint*interval '1 millisecond'))
        RETURNING challenge_expires_at`,[id,hash(challenge),p.client_id,p.redirect_uri,p.code_challenge,p.state,this.policy.challengeMs]);
      await this.event(c,"COMMERCIAL_NATIVE_CHALLENGE",correlation);
      return {challenge_id:id,challenge,expires_at:row.rows[0].challenge_expires_at.toISOString()};
    });
  }
  async register(p: Record<string,unknown>, proof: DeviceProofRequest) {
    const { purpose, challenge_id, challenge, ...material } = p;
    if (purpose !== "BUSINESS_NATIVE_AUTHORIZATION_V1" || !UuidV7Schema.safeParse(challenge_id).success ||
      !opaque(challenge) || !matches(material,this.registration)) return null;
    const device = await this.proofs.verifyRegistrationAndConsume(proof);
    if (!device) return null;
    return this.transaction(async c => {
      const token = randomBytes(32).toString("base64url");
      const active = await c.query(`SELECT 1 FROM identity.device_credentials dc JOIN identity.device_registry d
        ON d.device_id=dc.device_id AND d.installation_id=dc.installation_id AND d.tenant_id=dc.tenant_id AND d.company_id=dc.company_id
        WHERE dc.credential_id=$1 AND d.device_id=$2 AND d.installation_id=$3 AND d.tenant_id=$4 AND d.company_id=$5
          AND dc.status='ACTIVE' AND dc.issued_at<=clock_timestamp() AND dc.expires_at>clock_timestamp() AND d.status='ACTIVE'
        FOR SHARE OF dc,d`,[device.credentialId,device.deviceId,device.installationId,device.tenantId,device.companyId]);
      if (active.rowCount !== 1) return null;
      const row = await c.query(`UPDATE identity.native_authorization_requests SET request_hash=$1,credential_id=$2,device_id=$3,installation_id=$4,tenant_id=$5,company_id=$6,
        challenge_consumed_at=clock_timestamp(),expires_at=LEAST(clock_timestamp()+($7::bigint*interval '1 millisecond'),$8::timestamptz)
        WHERE id=$9 AND challenge_hash=$10 AND challenge_consumed_at IS NULL AND challenge_expires_at>clock_timestamp()
        AND client_id=$11 AND redirect_uri=$12 AND code_challenge=$13 AND state=$14 RETURNING expires_at`,
        [hash(token),device.credentialId,device.deviceId,device.installationId,device.tenantId,device.companyId,this.policy.requestMs,device.credentialExpiresAt,
          challenge_id,hash(challenge),material.client_id,material.redirect_uri,material.code_challenge,material.state]);
      if (row.rowCount !== 1) return null;
      await this.event(c,"COMMERCIAL_NATIVE_REQUEST_BOUND",proof.correlationId);
      return {request:token,expires_at:row.rows[0].expires_at.toISOString(),authorization_url:this.registration.authorizationOrigin+"/v1/commercial/login?request="+token};
    });
  }
}

export function createNativeRequestHandler(runtime?: NativeBusinessRequestRegistration, origin?: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.url !== CHALLENGE && req.url !== REGISTER) return false;
    if (req.method !== "POST") { sendCommercialJson(res,405,{code:"METHOD_NOT_ALLOWED"}); return true; }
    if (!runtime || !origin) { sendCommercialJson(res,503,{code:"NATIVE_AUTHORIZATION_NOT_PROVISIONED"}); return true; }
    try {
      inspectCommercialHeaders(req);
      if (!(req.socket instanceof TLSSocket) || req.headers.host !== new URL(origin).host) { sendCommercialJson(res,421,{code:"CENTRAL_HOST_REJECTED"}); return true; }
      const requestId=UuidSchema.parse(req.headers["x-request-id"]), correlationId=UuidV7Schema.parse(req.headers["x-correlation-id"]);
      const {object,raw}=await readCommercialJsonBody(req,16384);
      const result=req.url===CHALLENGE ? await runtime.challenge(object,correlationId) :
        typeof req.headers.authorization==="string" ? await runtime.register(object,{authorization:req.headers.authorization,requestId,correlationId,body:raw}) : null;
      sendCommercialJson(res,result?200:403,result??{code:"NATIVE_REQUEST_REJECTED"});
    } catch (error) {
      const status=typeof error==="object"&&error!==null&&"status" in error&&typeof error.status==="number"&&[400,413,415].includes(error.status)?error.status:503;
      sendCommercialJson(res,status,{code:"NATIVE_REQUEST_REJECTED"});
    }
    return true;
  };
}
