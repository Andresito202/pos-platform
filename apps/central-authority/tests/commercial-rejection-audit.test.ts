import {IncomingMessage, type ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {Socket} from "node:net";
import {afterEach,describe,expect,it,vi} from "vitest";
import {PostgresBrowserSessionHandoffWriter,type Pool} from "@pos-platform/database-postgres";
import {PlatformSecurityEventCode} from "@pos-platform/contracts";
import {prepareCommercialHttpHandler} from "../src/isolated-commercial-https.js";
import {BusinessInitialMfaFlow} from "../src/business-initial-mfa-flow.js";
import {BusinessSessionAuthority} from "../src/business-session-authority.js";
import {DurableBrowserSessionStore} from "../src/durable-browser-session-store.js";
import {CommercialNativeClientCatalog} from "../src/commercial-native-client-catalog.js";
import {IsolatedBusinessAuthCoordinator} from "../src/isolated-business-auth-coordinator.js";
import {IsolatedBusinessCredentialPairIssuer} from "../src/isolated-business-credential-pair-issuer.js";

// Protocol admission only. Transport and pool are unit doubles; no real TLS,
// PostgreSQL, identity, MFA, device, session or permission is authenticated.
async function fixture(maximum=2) {
  let pending:Promise<void>|undefined;
  const events:string[]=[];
  const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    if(sql.includes("current_database()"))return {rows:[{ok:true}]};
    if(sql.startsWith("SELECT clock_timestamp")){
      await pending;
      return {rows:[{at:new Date(Date.now())}]};
    }
    if(sql.includes("INSERT INTO identity.security_events")){
      events.push(String(args[4]));
      return {rows:[{user_id:null,session_id:null,tenant_id:null,event_code:args[4],result:args[5],
        reason_code:args[6],correlation_id:args[7],occurred_at:new Date(String(args[8])),server_recorded_at:new Date(Date.now())}]};
    }
    throw Error("Unexpected authentication/database operation");
  });
  const pool={options:{connectionString:"postgres://unused:unused@127.0.0.1:55433/pos_business_session_test_0000000000000000"},query} as unknown as Pool;
  const origin="https://business.example.test";
  const handler=await prepareCommercialHttpHandler({pool,tls:{},origin,
    // These unused owners are doubles, not trusted authentication evidence.
    mfa:Object.create(BusinessInitialMfaFlow.prototype) as BusinessInitialMfaFlow,
    authority:Object.create(BusinessSessionAuthority.prototype) as BusinessSessionAuthority,
    handoffs:Object.create(PostgresBrowserSessionHandoffWriter.prototype) as PostgresBrowserSessionHandoffWriter,
    browser:new DurableBrowserSessionStore(pool,origin,{mode:"ISOLATED_VALIDATION",lifetimeMs:60000,idleTimeoutMs:60000,maximumReauthenticationAgeMs:60000}),
    clients:Object.create(CommercialNativeClientCatalog.prototype) as CommercialNativeClientCatalog,
    coordinator:Object.create(IsolatedBusinessAuthCoordinator.prototype) as IsolatedBusinessAuthCoordinator,
    pair:Object.create(IsolatedBusinessCredentialPairIssuer.prototype) as IsolatedBusinessCredentialPairIssuer,
    policy:{mode:"ISOLATED_VALIDATION",maximumBodyBytes:1024,requestsPerMinute:maximum,maximumBuckets:8}});
  const invoke=(address="127.0.0.1")=>new Promise<number>(resolve=>{
    const socket=new TLSSocket(new Socket());
    Object.defineProperty(socket,"remoteAddress",{value:address});
    const request=new IncomingMessage(socket);
    request.method="GET";request.url="/v1/commercial/invalid";request.headers.host="business.example.test";
    let status=0;
    const response={writeHead:(code:number)=>{status=code;},end:()=>{socket.destroy();resolve(status);}} as unknown as ServerResponse;
    handler(request,response);
  });
  return {invoke,query,events,clockCount:()=>query.mock.calls.filter(([sql])=>sql.startsWith("SELECT clock_timestamp")).length,
    hold:()=>{let release!:()=>void;pending=new Promise<void>(resolve=>{release=resolve;});return release;}};
}
afterEach(()=>vi.restoreAllMocks());

describe("BUSINESS rejected-request persistence admission",()=>{
  it("bounds concurrent pool work while preserving a separate abuse sample",async()=>{
    const f=await fixture();const release=f.hold();
    const requests=Array.from({length:200},()=>f.invoke());
    try{await Promise.resolve();await Promise.resolve();expect(f.clockCount()).toBeLessThanOrEqual(2);}
    finally{release();}
    const statuses=await Promise.all(requests);
    expect(statuses.filter(s=>s===400)).toHaveLength(2);
    expect(statuses.filter(s=>s===429)).toHaveLength(198);
    expect(f.events).toContain(PlatformSecurityEventCode.ABUSE_RATE_LIMITED);
    expect(f.events).toContain(PlatformSecurityEventCode.CREDENTIAL_REJECTED);
  });
  it("bounds sequential rejections and address churn without resetting request budgets",async()=>{
    const f=await fixture();
    for(let i=0;i<50;i++)await f.invoke(`192.0.2.${i+1}`);
    expect(f.clockCount()).toBeLessThanOrEqual(4);
    expect(f.events).toContain(PlatformSecurityEventCode.ABUSE_RATE_LIMITED);
  });
  it("retains consumed audit budget after persistence errors and never authenticates",async()=>{
    const f=await fixture(1);
    f.query.mockImplementation(async sql=>{throw Error("private database detail: "+sql);});
    expect(await f.invoke()).toBe(503);
    expect(await f.invoke()).toBe(503);
    expect(await f.invoke()).toBe(429);
    expect(f.clockCount()).toBe(2);
  });
  it("reopens bounded audit admission in a new window, but denies clock rollback",async()=>{
    const now=vi.spyOn(Date,"now").mockReturnValue(180000);
    const f=await fixture(1);
    expect(await f.invoke()).toBe(400);expect(await f.invoke()).toBe(429);
    now.mockReturnValue(179999);expect(await f.invoke()).toBe(429);expect(f.clockCount()).toBe(2);
    now.mockReturnValue(240000);expect(await f.invoke()).toBe(400);expect(await f.invoke()).toBe(429);
    expect(f.clockCount()).toBe(4);
  });
});
