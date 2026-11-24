import {createHash,randomBytes} from "node:crypto";
import type {PoolClient} from "pg";
import type {PersistedBusinessSession} from "./business-session-creation-transaction.js";
import type {CommittedBusinessInitialMfa} from "./business-initial-webauthn-transaction.js";

/** Installed only in the canonical MFA -> BUSINESS transaction. No method
 * accepts a serialized session as authority to redeem or mint a browser cookie.
 */
export class PostgresBrowserSessionHandoffWriter {
  private readonly issued=new WeakMap<object,string>();
  private readonly origin:string;
  constructor(origin:string,private readonly lifetimeMs:number){
    const url=new URL(origin);
    if(url.protocol!=="https:"||url.origin!==origin||url.username||url.password)throw Error("BROWSER_HANDOFF_ORIGIN_REQUIRED");
    if(!Number.isSafeInteger(lifetimeMs)||lifetimeMs<=0)throw Error("BROWSER_HANDOFF_LIFETIME_REQUIRED");
    this.origin=origin;
  }
  /** Internal completion hook, invoked BEFORE the session transaction commits. */
  readonly write=async(client:PoolClient,session:PersistedBusinessSession,evidence:CommittedBusinessInitialMfa):Promise<void>=>{
    const token=randomBytes(32).toString("base64url");
    const hash=createHash("sha256").update(token).digest("hex");
    await client.query(`INSERT INTO identity.browser_session_handoffs
      (handoff_hash,session_id,user_id,tenant_id,membership_id,challenge_id,
       password_credential_id,password_credential_version,factor_id,origin,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        LEAST(clock_timestamp()+($11::bigint*interval '1 millisecond'),$12::timestamptz))`,
      [hash,session.sessionId,session.userId,session.tenantId,session.tenantMembershipId,evidence.challengeId,
        evidence.passwordCredentialId,evidence.passwordCredentialVersion,evidence.factorId,this.origin,this.lifetimeMs,session.expiresAt]);
    this.issued.set(session,token);
  };
  /** Only the exact successfully returned session object has an output. */
  take(session:unknown):string|null{
    if(!session||typeof session!=="object")return null;
    const token=this.issued.get(session)??null;this.issued.delete(session);return token;
  }
}
