import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  assertAcceptance,
  type LocalChannelReplayStateStore,
  type ReplayAcceptance,
  windowsHandoffReplaySessionId,
  type WindowsHandoffRevocationAuthority,
} from "@pos-platform/local-channel";
import { createHash } from "node:crypto";
import type { WindowsChannelHandoff } from "@pos-platform/contracts";

/**
 * Anti-replay persistente. Implementa el puerto que declara
 * `@pos-platform/local-channel` y es el único punto donde el estado del canal
 * toca la base local, que sólo el servicio escribe (`DEC-010` §118).
 */
export class SqliteReplayStateStore implements LocalChannelReplayStateStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly maxSessions = 1_024,
  ) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
      throw new Error("max replay sessions must be a positive integer");
    }
  }

  accept(input: ReplayAcceptance): void {
    assertAcceptance(input);
    const transaction = this.database.native.transaction(() => {
      this.database.native.prepare(
        "DELETE FROM local_channel_replay_state WHERE expires_at <= ?",
      ).run(input.evaluatedAt);

      const current = this.database.native.prepare(
        "SELECT highest_sequence, expires_at FROM local_channel_replay_state WHERE session_id = ?",
      ).get(input.sessionId) as { highest_sequence: number; expires_at: string } | undefined;

      if (current === undefined) {
        const count = this.database.native.prepare(
          "SELECT count(*) AS count FROM local_channel_replay_state",
        ).get() as { count: number };
        if (count.count >= this.maxSessions) {
          throw new Error("local channel session capacity reached");
        }
      } else if (input.sequence <= current.highest_sequence) {
        throw new Error("local channel replay rejected");
      }

      const expiresAt = current === undefined || current.expires_at < input.expiresAt
        ? input.expiresAt
        : current.expires_at;
      this.database.native.prepare(`
        INSERT INTO local_channel_replay_state(session_id, highest_sequence, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          highest_sequence = excluded.highest_sequence,
          expires_at = excluded.expires_at
      `).run(input.sessionId, input.sequence, expiresAt);
    });
    transaction();
  }
}


/**
 * The existing Service-owned SQLite replay table is the durable lease ledger:
 * no new database, migration, or separate protocol. A revocation has a
 * distinct persistent marker; checking it and consuming the lease happen
 * under the same SQLite transaction.
 *
 * Candidate only: commercial SCM stays blocked until the pipe peers are
 * identified by Windows and active connections can be terminated on revoke.
 */
export class SqliteWindowsHandoffLeaseAuthority
  implements LocalChannelReplayStateStore, WindowsHandoffRevocationAuthority {
  private pending: {sessionId:string;expiresAt:string;leaseId:string;authorizedAt:number}|undefined;
  private readonly replay:SqliteReplayStateStore;

  constructor(
    private readonly database:LocalDatabase,
    private readonly approved:WindowsChannelHandoff,
    private readonly clock:()=>Date=()=>new Date(),
  ) {
    this.replay=new SqliteReplayStateStore(database);
  }

  private revokedId(leaseId:string):string{
    if(!/^[a-f0-9]{64}$/.test(leaseId))throw Error("HANDOFF_LEASE_INVALID");
    return windowsHandoffReplaySessionId(
      createHash("sha256").update("WINDOWS_HANDOFF_REVOKED_V1:").update(leaseId).digest("hex"));
  }
  private isRevoked(leaseId:string,now:Date):boolean{
    const row=this.database.native.prepare(
      "SELECT expires_at FROM local_channel_replay_state WHERE session_id = ?",
    ).get(this.revokedId(leaseId)) as {expires_at:string}|undefined;
    return row!==undefined && Date.parse(row.expires_at)>now.getTime();
  }
  assertActive(input:Readonly<{
    leaseId:string;revision:number;serviceSid:string;
    installationId:string;deviceId:string;policyReference:string;
    recipientSid:string;recipientLogonSid:string;expiresAt:string;
  }>):void{
    const now=this.clock();
    const p=this.approved;
    this.pending=undefined;
    if(!Number.isFinite(now.getTime())||
      input.revision!==p.revision||input.serviceSid!==p.service_sid||
      input.installationId!==p.installation_id||input.deviceId!==p.device_id||
      input.policyReference!==p.policy_reference||
      input.recipientSid!==p.recipient_sid||
      input.recipientLogonSid!==p.recipient_logon_sid||
      input.expiresAt!==p.expires_at||
      now.getTime()<Date.parse(p.not_before)||
      now.getTime()>=Date.parse(p.expires_at)||
      !/^[a-f0-9]{64}$/.test(input.leaseId)||
      this.isRevoked(input.leaseId,now)){
      throw Error("HANDOFF_LEASE_NOT_AUTHORIZED");
    }
    this.pending={sessionId:windowsHandoffReplaySessionId(input.leaseId),
      expiresAt:input.expiresAt,leaseId:input.leaseId,authorizedAt:now.getTime()};
  }

  accept(input:ReplayAcceptance):void{
    assertAcceptance(input);
    const pending=this.pending;
    this.pending=undefined;
    if(!pending||input.sessionId!==pending.sessionId||input.expiresAt!==pending.expiresAt||
      input.sequence!==1)throw Error("HANDOFF_LEASE_NOT_AUTHORIZED");
    this.database.native.transaction(()=>{
      // Authorization precedes native DPAPI work. Recheck the Service clock
      // at consumption; a receipt timestamp cannot extend a lease or prune
      // still-live replay/revocation records. A failed attempt burns pending.
      const now=this.clock(),time=now.getTime();
      if(!Number.isFinite(time)||time<pending.authorizedAt||
        time<Date.parse(this.approved.not_before)||time>=Date.parse(pending.expiresAt)){
        throw Error("HANDOFF_LEASE_NOT_AUTHORIZED");
      }
      if(this.isRevoked(pending.leaseId,now)){
        throw Error("HANDOFF_LEASE_REVOKED");
      }
      this.replay.accept({...input,evaluatedAt:now.toISOString()});
    })();
  }

  /** Idempotent revocation, retained until expiration. */
  revoke(leaseId:string):void{
    const expiresAt=Date.parse(this.approved.expires_at),now=this.clock();
    if(!Number.isFinite(now.getTime())||now.getTime()>=expiresAt)throw Error("HANDOFF_LEASE_EXPIRED");
    const revocationId=this.revokedId(leaseId);
    this.database.native.prepare("INSERT INTO local_channel_replay_state(session_id,highest_sequence,expires_at) VALUES (?,1,?) ON CONFLICT(session_id) DO UPDATE SET expires_at = excluded.expires_at").run(revocationId,this.approved.expires_at);
    if(this.pending?.leaseId===leaseId)this.pending=undefined;
  }
}
