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
