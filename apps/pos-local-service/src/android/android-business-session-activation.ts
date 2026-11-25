import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SessionActivationService } from "../session/session-activation.js";
import type { SqliteAuthorizationSnapshotStore } from "../authorization/sqlite-authorization-snapshot-store.js";
import type { AuthorizationSnapshotVerifier } from "../security/authorization-snapshot-verifier.js";
import { boundIdentityFromClaims, type SessionBindingRegistry } from "../session/session-binding-registry.js";
import type { AndroidTokenExchangeResult } from "./android-business-native-central.js";

/** Only called by the privileged native token exchange, never an arbitrary IPC artifact upload. */
export class AndroidBusinessSessionActivation {
  constructor(private readonly database: LocalDatabase,
    private readonly sessions: SessionActivationService,
    private readonly snapshots: SqliteAuthorizationSnapshotStore,
    private readonly verifier: AuthorizationSnapshotVerifier,
    private readonly bindings: SessionBindingRegistry,
    private readonly scope: {installationId:string;deviceId:string;tenantId:string;companyId:string;branchId:string}) {}

  activate(pair: AndroidTokenExchangeResult, connectionId: string): void {
    this.bindings.release(connectionId);
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
    this.bindings.bind(connectionId,boundIdentityFromClaims(ssa.claims));
  }
}
