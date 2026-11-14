import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { WindowsChannelHandoff } from "@pos-platform/contracts";
import { windowsHandoffReplaySessionId } from "@pos-platform/local-channel";
import { SqliteWindowsHandoffLeaseAuthority } from "../src/channel/sqlite-replay-state.js";

const at=new Date("2026-10-29T12:00:00Z");
const p={
  profile:"CAMACHO_WINDOWS_CHANNEL_HANDOFF_CANDIDATE_V1",
  service_id:"CamachoPOSLocalService",
  service_sid:"S-1-5-80-1-2-3-4-5",
  installation_id:"018f0000-0000-7000-8000-000000000001",
  device_id:"018f0000-0000-7000-8000-000000000002",
  recipient_sid:"S-1-5-21-1-2-3-1001",
  recipient_logon_sid:"S-1-5-5-1-2",recipient_session_id:1,
  recipient_public_key_pem:"TEST_CANDIDATE_POLICY_ONLY",
  recipient_key_sha256:"1".repeat(64),
  capsule_file:"C:\\ProgramData\\CamachoPOS\\handoff\\capsule.json",
  not_before:"2026-10-29T11:59:00Z",expires_at:"2026-10-29T12:01:00Z",
  revision:1,poll_ms:1000,policy_reference:"TEST_ONLY",
} as WindowsChannelHandoff;
const dirs:string[]=[];
const openDatabases=new Set<LocalDatabase>();
function track(db:LocalDatabase):LocalDatabase{
  openDatabases.add(db);
  return db;
}
function closeTracked(db:LocalDatabase):void{
  if(openDatabases.delete(db))db.close();
}
function open(){
  const dir=mkdtempSync(join(tmpdir(),"pos-handoff-lease-sqlite-"));
  dirs.push(dir);
  return {dir,db:track(LocalDatabase.open({dataDirectory:dir}))};
}
function scope(leaseId:string){
  return {leaseId,revision:p.revision,serviceSid:p.service_sid,
    installationId:p.installation_id,deviceId:p.device_id,
    policyReference:p.policy_reference,recipientSid:p.recipient_sid,
    recipientLogonSid:p.recipient_logon_sid,expiresAt:p.expires_at};
}
function receipt(leaseId:string){
  return {sessionId:windowsHandoffReplaySessionId(leaseId),sequence:1,
    evaluatedAt:at.toISOString(),expiresAt:p.expires_at};
}
afterEach(()=>{
  // A failing expectation must not leave a SQLite/WAL handle open on Windows.
  // Only the temporary databases opened by this test file are affected.
  try{
    for(const db of [...openDatabases])closeTracked(db);
  }finally{
    for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});
  }
});

describe("Service-owned SQLite candidate handoff lease ledger",()=>{
  it.each([60_000,60_001])("rejects a pending consumption after %i ms even with an old receipt timestamp",elapsed=>{
    const {db}=open(),leaseId="f".repeat(64);
    let now=at;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>now);
    ledger.assertActive(scope(leaseId));
    now=new Date(at.getTime()+elapsed);
    expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    expect(db.native.prepare("SELECT count(*) AS count FROM local_channel_replay_state").get()).toEqual({count:0});
  },25000);

  it("rejects clock rollback between authorization and consumption",()=>{
    const {db}=open(),leaseId="e".repeat(64);
    let now=at;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>now);
    ledger.assertActive(scope(leaseId));
    now=new Date(at.getTime()-1);
    expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    now=at;
    expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
  });

  it("rejects an invalid host clock at consumption",()=>{
    const {db}=open(),leaseId="f".repeat(64);
    let now=at;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>now);
    ledger.assertActive(scope(leaseId));
    now=new Date(NaN);
    expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
  });

  it("uses the Service clock rather than the receipt timestamp to prune replay records",()=>{
    const {db}=open(),leaseId="e".repeat(64),other=windowsHandoffReplaySessionId("f".repeat(64));
    db.native.prepare("INSERT INTO local_channel_replay_state(session_id,highest_sequence,expires_at) VALUES (?,1,?)")
      .run(other,new Date(at.getTime()+10_000).toISOString());
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    ledger.assertActive(scope(leaseId));
    ledger.accept({...receipt(leaseId),evaluatedAt:new Date(at.getTime()+30_000).toISOString()});
    expect(db.native.prepare("SELECT highest_sequence FROM local_channel_replay_state WHERE session_id = ?").get(other))
      .toEqual({highest_sequence:1});
  });

  it("rechecks revocation made by another authority between authorization and consumption",()=>{
    const {db}=open(),leaseId="f".repeat(64);
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    ledger.assertActive(scope(leaseId));
    new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at).revoke(leaseId);
    expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_REVOKED");
  });

  it("persists one-use receipt across a real SQLite close and reopen",()=>{
    const {db,dir}=open(),leaseId="a".repeat(64);
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    ledger.assertActive(scope(leaseId));ledger.accept(receipt(leaseId));
    expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    closeTracked(db);
    const reopened=track(LocalDatabase.open({dataDirectory:dir}));
    try{
      const next=new SqliteWindowsHandoffLeaseAuthority(reopened,p,()=>at);
      next.assertActive(scope(leaseId));
      expect(()=>next.accept(receipt(leaseId))).toThrow("local channel replay rejected");
    }finally{closeTracked(reopened);}
  });

  it("revokes before first use, persists across restart, and accepts idempotent revocation",()=>{
    const {db,dir}=open(),leaseId="b".repeat(64);
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    ledger.revoke(leaseId);ledger.revoke(leaseId);
    expect(()=>ledger.assertActive(scope(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    closeTracked(db);
    const reopened=track(LocalDatabase.open({dataDirectory:dir}));
    try{
      expect(()=>new SqliteWindowsHandoffLeaseAuthority(reopened,p,()=>at)
        .assertActive(scope(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    }finally{closeTracked(reopened);}
  });

  it("revocation after consumption blocks future lease checks",()=>{
    const {db}=open(),leaseId="c".repeat(64);
    try{
      const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
      ledger.assertActive(scope(leaseId));ledger.accept(receipt(leaseId));
      ledger.revoke(leaseId);
      expect(()=>ledger.assertActive(scope(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    }finally{closeTracked(db);}
  });

  it("refuses unauthorised policy, identity, revision and unregistered receipts",()=>{
    const {db}=open(),leaseId="d".repeat(64);
    try{
      const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
      expect(()=>ledger.accept(receipt(leaseId))).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
      for(const diff of [{revision:2},{serviceSid:"S-1-5-80-6-7-8-9-10"},
        {recipientLogonSid:"S-1-5-5-4-5"},{policyReference:"OTHER"},
        {installationId:p.device_id},{deviceId:p.installation_id}]){
        expect(()=>ledger.assertActive({...scope(leaseId),...diff})).toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
      }
      ledger.assertActive(scope(leaseId));
      expect(()=>ledger.accept({...receipt(leaseId),sessionId:windowsHandoffReplaySessionId("e".repeat(64))}))
        .toThrow("HANDOFF_LEASE_NOT_AUTHORIZED");
    }finally{closeTracked(db);}
  });
});

describe("runtime lease connection authorization (real disposable SQLite)",()=>{
  it("consumes once for several live connections; revocation commits before closing all and survives restart",()=>{
    const {db,dir}=open(),lease="1".repeat(64),closed:string[]=[];
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    for(const id of ["a","b","c"])ledger.admitConnection(lease,id,()=>{
      expect(ledger.leaseForConnection(id)).toBeUndefined();
      expect(()=>new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at).assertActive(scope(lease))).toThrow();
      closed.push(id);if(id==="a")throw Error("close failure");
    });
    expect(db.native.prepare("SELECT highest_sequence FROM local_channel_replay_state WHERE session_id=?").get(windowsHandoffReplaySessionId(lease))).toEqual({highest_sequence:1});
    ledger.assertConnectionActive("b");ledger.revoke(lease);
    expect(closed).toEqual(["a","b","c"]);
    expect(()=>ledger.assertConnectionActive("b")).toThrow();
    expect(()=>ledger.admitConnection(lease,"new",()=>{})).toThrow();
    closeTracked(db);const reopened=track(LocalDatabase.open({dataDirectory:dir}));
    expect(()=>new SqliteWindowsHandoffLeaseAuthority(reopened,p,()=>at).admitConnection(lease,"new",()=>{})).toThrow();
  });
  it("does not restore a consumed lease on authority restart, even without revocation",()=>{
    const {db}=open(),lease="2".repeat(64);
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    ledger.admitConnection(lease,"a",()=>{});ledger.closeConnections();
    expect(()=>new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at).admitConnection(lease,"b",()=>{})).toThrow("replay");
  });
  it.each(["expiry","rollback","invalid"])("rejects each operation and closes on %s",mode=>{
    const {db}=open();let now=at,closed=0;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>now);
    ledger.admitConnection("3".repeat(64),"a",()=>closed++);
    now=mode==="expiry"?new Date(p.expires_at):mode==="rollback"?new Date(at.getTime()-1):new Date(NaN);
    expect(()=>ledger.assertConnectionActive("a")).toThrow();expect(closed).toBe(1);
    expect(ledger.leaseForConnection("a")).toBeUndefined();
  });
  it("fails closed on durable write failure without reporting successful revocation",()=>{
    const {db}=open();let closed=0;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at),lease="4".repeat(64);
    ledger.admitConnection(lease,"a",()=>closed++);ledger.admitConnection(lease,"b",()=>closed++);
    db.native.pragma("query_only = ON");
    expect(()=>ledger.revoke(lease)).toThrow();expect(closed).toBe(2);
    expect(()=>ledger.assertConnectionActive("a")).toThrow();
    db.native.pragma("query_only = OFF");
    expect(()=>ledger.admitConnection(lease,"c",()=>{})).toThrow("replay");
  });
  it("drains only the initiating response and removes its authority immediately",()=>{
    const {db}=open(),lease="5".repeat(64);let closed=0,drained=0;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>at);
    ledger.admitConnection(lease,"a",()=>closed++);ledger.admitConnection(lease,"b",()=>closed++);
    ledger.revoke(lease,"a",()=>{drained++;expect(ledger.leaseForConnection("a")).toBeUndefined();});
    expect({closed,drained}).toEqual({closed:1,drained:1});
    expect(()=>ledger.assertConnectionActive("a")).toThrow();
  });
  it("does not let MAC replay cleanup delete lease tombstones after a host clock jump",()=>{
    const {db}=open(),lease="6".repeat(64);let now=at;
    const ledger=new SqliteWindowsHandoffLeaseAuthority(db,p,()=>now);
    ledger.admitConnection(lease,"a",()=>{});ledger.revoke(lease);
    const before=db.native.prepare("SELECT count(*) AS n FROM local_channel_replay_state").get();
    now=new Date(at.getTime()+120_000);
    expect(()=>ledger.acceptTransportFrame({...receipt("7".repeat(64)),expiresAt:new Date(now.getTime()+60_000).toISOString()})).toThrow();
    expect(db.native.prepare("SELECT count(*) AS n FROM local_channel_replay_state").get()).toEqual(before);
    now=at;expect(()=>ledger.admitConnection(lease,"b",()=>{})).toThrow();
  });

});
