import * as z from "zod";
import type { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SessionActivationService } from "../session/session-activation.js";
import type { SqliteAuthorizationSnapshotStore } from "../authorization/sqlite-authorization-snapshot-store.js";
import type { AuthorizationSnapshotVerifier } from "../security/authorization-snapshot-verifier.js";
import { boundIdentityFromClaims, type SessionBindingRegistry } from "../session/session-binding-registry.js";
import type { AndroidTokenExchangeResult } from "./android-business-native-central.js";

const refreshTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{64}$/);
const markerSchema=z.discriminatedUnion("state",[
  z.strictObject({state:z.literal("CLOSED"), revocationToken: refreshTokenSchema.optional()}),
  z.strictObject({state:z.literal("ACTIVE"),userId:z.uuid(),sessionId:z.uuid(),ssaSequence:z.number().int().positive(),sasSequence:z.number().int().positive(),
    refreshToken: refreshTokenSchema.optional(), revocationToken: refreshTokenSchema.optional()})
]);
type SessionMarker=z.infer<typeof markerSchema>;
/** Protected session selector; never replaces signed SSA/SAS or their replay floors. */
export class AndroidSessionCustody {
  private readonly name="android-business-session";
  constructor(private readonly store:EncryptedFileSecretStore){
    if(store.protection!=="OS_BOUND") throw Error("ANDROID_SESSION_OS_CUSTODY_REQUIRED");
  }
  read():SessionMarker {
    if (!this.store.has(this.name)) return { state: "CLOSED" };
    const bytes = this.store.read(this.name);
    try { return markerSchema.parse(JSON.parse(bytes.toString("utf8"))); }
    finally { bytes.fill(0); }
  }
  write(marker:SessionMarker):void {
    const bytes = Buffer.from(JSON.stringify(markerSchema.parse(marker)));
    try { this.store.write(this.name, bytes); }
    finally { bytes.fill(0); }
  }
  beginRefresh(): { token: string; sessionId: string; userId: string } | null {
    const marker = this.read();
    if (marker.state !== "ACTIVE" || !marker.refreshToken) return null;
    const token = marker.refreshToken;
    // A lost response may have rotated this token. Retain it solely for logout.
    this.write({ ...marker, refreshToken: undefined, revocationToken: token });
    return { token, sessionId: marker.sessionId, userId: marker.userId };
  }
  destroy():void {this.store.destroy();}
}

/** Only called by the privileged native token exchange, never an arbitrary IPC artifact upload. */
export class AndroidBusinessSessionActivation {
  constructor(private readonly database: LocalDatabase,
    private readonly sessions: SessionActivationService,
    private readonly snapshots: SqliteAuthorizationSnapshotStore,
    private readonly verifier: AuthorizationSnapshotVerifier,
    private readonly bindings: SessionBindingRegistry,
    private readonly scope: {installationId:string;deviceId:string;tenantId:string;companyId:string;branchId:string},
    private readonly custody:AndroidSessionCustody) {}

  /** Revalidate both persisted signatures for every privileged request. */
  authorize(connectionId: string): boolean {
    try {
      const identity=this.bindings.resolve(connectionId);
      if(!identity) return false;
      const marker=this.custody.read();
      if(marker.state!=="ACTIVE" || marker.userId!==identity.userId || marker.sessionId!==identity.ssaSessionId) throw Error("ANDROID_SESSION_CLOSED");
      const binding={userId:identity.userId,installationId:this.scope.installationId,deviceId:this.scope.deviceId};
      const session=this.sessions.recover(binding);
      const snapshot=this.snapshots.loadActive(binding);
      if(session.kind!=="ACTIVE" || session.session.claims.session_id!==identity.ssaSessionId || session.session.claims.sequence!==marker.ssaSequence || !snapshot || snapshot.claims.sequence!==marker.sasSequence) throw Error("ANDROID_SESSION_INVALID");
      if(this.verifier.verify({claims:snapshot.claims,signature:snapshot.signature},binding).decision!=="VALID") throw Error("ANDROID_SAS_REJECTED");
      return true;
    } catch {
      this.bindings.release(connectionId);
      return false;
    }
  }

  /** Normal shutdown disconnects the transport, not the durable session. */
  disconnect(connectionId:string):void {
    this.bindings.release(connectionId);
    this.custody.destroy();
  }

  close(connectionId:string):void {
    this.bindings.release(connectionId);
    const marker = this.custody.read();
    const revocationToken = marker.state === "ACTIVE" ? marker.refreshToken ?? marker.revocationToken : marker.revocationToken;
    this.custody.write({state:"CLOSED", revocationToken});
  }

  pendingRevocation(): string | undefined {
    const marker = this.custody.read();
    return marker.state === "CLOSED" ? marker.revocationToken : undefined;
  }

  confirmRevocation(token: string): void {
    if (this.pendingRevocation() === token) this.custody.write({ state: "CLOSED" });
  }

  beginRefresh() {
    return this.custody.beginRefresh();
  }

  recover(connectionId:string):boolean {
    this.bindings.release(connectionId);
    try {
      const marker=this.custody.read();
      if(marker.state!=="ACTIVE") return false;
      const binding={userId:marker.userId,installationId:this.scope.installationId,deviceId:this.scope.deviceId};
      const session=this.sessions.recover(binding);
      if(session.kind!=="ACTIVE" || session.session.claims.session_id!==marker.sessionId || session.session.claims.sequence!==marker.ssaSequence) return false;
      this.bindings.bind(connectionId,boundIdentityFromClaims(session.session.claims));
      return this.authorize(connectionId);
    } catch {
      this.bindings.release(connectionId);
      return false;
    }
  }

  activate(pair: AndroidTokenExchangeResult, connectionId: string): void {
    const ssa = pair.session_assertion;
    const sas = pair.authorization_snapshot;
    const binding = {userId:ssa.claims.user_id,installationId:this.scope.installationId,deviceId:this.scope.deviceId};
    this.database.native.transaction(()=>{
      const verified = this.verifier.verify(sas,binding);
      if (verified.decision !== "VALID" || !verified.claims) throw Error("ANDROID_SAS_REJECTED");
      if (!verified.claims.assignments.some(a=>a.tenant_id===this.scope.tenantId &&
          (a.company_id===null || a.company_id===this.scope.companyId) &&
          (a.branch_id===null || a.branch_id===this.scope.branchId) && a.status==="ACTIVE" && a.role_status==="ACTIVE")) {
        throw Error("ANDROID_SAS_SCOPE_REJECTED");
      }
      if (this.sessions.activate(ssa,binding).kind !== "ACTIVATED") throw Error("ANDROID_SSA_REJECTED");
      if (this.snapshots.activate(sas,binding).kind !== "ACTIVATED") throw Error("ANDROID_SAS_SEQUENCE_REJECTED");
    })();
    // A crash before this protected write leaves a closed session, not an implicit login.
    this.custody.write({state:"ACTIVE",userId:ssa.claims.user_id,sessionId:ssa.claims.session_id,ssaSequence:ssa.claims.sequence,
      sasSequence:sas.claims.sequence,refreshToken:pair.refreshToken});
    this.bindings.release(connectionId);
    this.bindings.bind(connectionId,boundIdentityFromClaims(ssa.claims));
  }
}
