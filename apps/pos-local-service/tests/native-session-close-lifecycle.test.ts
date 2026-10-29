import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {LocalDatabase} from "@pos-platform/database-sqlite";
import {CommercialComponent} from "../src/commercial/commercial-component.js";
import {DurableSyncStore} from "../src/sync/durable-sync-store.js";
import {SqliteSessionAssertionStore} from "../src/session/sqlite-session-assertion-store.js";
import type {ServiceConfig} from "../src/config.js";

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
  const directory=mkdtempSync(join(tmpdir(),"pos-session-close-")),db=LocalDatabase.open({dataDirectory:directory});
  const config={tenant_id:randomUUID(),company_id:randomUUID(),branch_id:randomUUID(),device_id:randomUUID(),installation_id:randomUUID()} as ServiceConfig;
  const component=new CommercialComponent(config,{database:db} as never,{store:new DurableSyncStore(db)} as never);
  cleanup.push(async()=>{await component.stop();db.close();rmSync(directory,{recursive:true,force:true});});
  await component.start();
  const session=randomUUID(),identity={userId:randomUUID(),ssaSessionId:session,tenantMembershipId:randomUUID(),offlineValidUntil:new Date(Date.now()+60000).toISOString()};
  // Binding fixture only. This suite tests durable invalidation, not SSA/MFA.
  component.bindings.bind("logout",identity);component.bindings.bind("renderer",identity);
  return {component,db,session};
}
describe("native session close: durable tombstone before transport notification",()=>{
  it("notifies all server connections only after the tombstone and binding removal",async()=>{
    const {component,session}=await fixture(),seen:string[]=[];
    component.registerNativeSessionCloser((ids,initiator)=>{
      expect(component.sessionStore.isClosed(session)).toBe(true);
      expect(component.bindings.size).toBe(0);expect(initiator).toBe("logout");seen.push(...ids);
    });
    expect(component.closeNativeSession("logout")).toBe(session);
    expect(seen).toEqual(["logout","renderer"]);
    expect(component.closeNativeSession("logout")).toBeNull();
  });
  it("a failed durable audit leaves bindings intact and does not report closure",async()=>{
    const {component,db}=await fixture(),close=vi.fn();component.registerNativeSessionCloser(close);
    db.native.exec("CREATE TRIGGER reject_close BEFORE INSERT ON local_security_audit WHEN NEW.event_type='BUSINESS_SESSION_CLOSED' BEGIN SELECT RAISE(ABORT,'TEST_AUDIT_FAILURE'); END");
    expect(()=>component.closeNativeSession("logout")).toThrow("TEST_AUDIT_FAILURE");
    expect(close).not.toHaveBeenCalled();expect(component.bindings.size).toBe(2);
  });
  it("a new store instance sees the durable close without an in-memory registry",async()=>{
    const {component,db,session}=await fixture();component.closeNativeSession("logout");
    expect(new SqliteSessionAssertionStore(db).isClosed(session)).toBe(true);
    expect(db.native.prepare("SELECT count(*) AS n FROM local_security_audit WHERE event_type='BUSINESS_SESSION_CLOSED'").get()).toEqual({n:1});
  });
  it("registers one closer and safely releases its registration on lifecycle stop",async()=>{
    const {component}=await fixture(),old=vi.fn(),next=vi.fn(),release=component.registerNativeSessionCloser(old);
    expect(()=>component.registerNativeSessionCloser(next)).toThrow("NATIVE_SESSION_CLOSER_ALREADY_REGISTERED");
    release();component.registerNativeSessionCloser(next);release();
    component.closeNativeSession("logout");expect(old).not.toHaveBeenCalled();expect(next).toHaveBeenCalledTimes(1);
  });
});
