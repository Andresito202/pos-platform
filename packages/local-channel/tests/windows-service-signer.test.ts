import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const host=vi.hoisted(()=>({id:{sid:"S-1-5-80-1-2-3-4-5",logonSid:"S-1-5-5-0-1",sessionId:0,service:true,interactive:false},record:"",key:Buffer.alloc(0)}));
vi.mock("../src/windows-handoff-native.js",()=>({currentHandoffIdentity:()=>host.id,handoffNative:(p:Record<string,unknown>)=>{
 switch(p.action){case "protect-service-signer":host.key=Buffer.from(p.bytes as string,"base64");return "DPAPI_TEST_PORT";
 case "write-service-signer":if(host.record)throw Error("exists");host.record=p.content as string;return "OK";
 case "read-service-signer":return host.record;case "open-service-signer":return host.key.toString("base64");default:throw Error("unexpected");}
}}));
import {prepareWindowsServiceSigner,withWindowsServiceSigner,recoverWindowsServiceSignerPublic} from "../src/windows-service-signer.js";
const args=["C:\\ServiceOnly\\signer.json","018f0000-0000-7000-8000-000000000001","018f0000-0000-7000-8000-000000000002"] as const;
beforeEach(()=>{host.record="";host.id.service=true;host.id.interactive=false;host.id.sessionId=0;});afterEach(()=>host.key.fill(0));
describe("service signer custody with an explicit DPAPI test port",()=>{
 it("recovers only the independently pinned key and clears its temporary DER",()=>{
  const enrolled=prepareWindowsServiceSigner(...args);expect(recoverWindowsServiceSignerPublic(...args)).toEqual(enrolled);expect(host.record).not.toContain(host.key.toString("base64"));let used:Buffer|undefined;
  withWindowsServiceSigner(...args,enrolled.public_key_pem,enrolled.spki_sha256,key=>{used=key;expect(key.some(n=>n!==0)).toBe(true);});expect(used?.every(n=>n===0)).toBe(true);
 });
 it("clears DER if the consumer throws and does not overwrite an existing signer",()=>{
  const e=prepareWindowsServiceSigner(...args);let used:Buffer|undefined;
  expect(()=>withWindowsServiceSigner(...args,e.public_key_pem,e.spki_sha256,key=>{used=key;throw Error("seal failed");})).toThrow();expect(used?.every(n=>n===0)).toBe(true);
  expect(()=>prepareWindowsServiceSigner(...args)).toThrow("exists");
 });
 it("rejects a wrong signer pin, installation and actual Service identity",()=>{
  const e=prepareWindowsServiceSigner(...args);
  expect(()=>withWindowsServiceSigner(...args,e.public_key_pem,"0".repeat(64),()=>{})).toThrow();
  expect(()=>withWindowsServiceSigner(args[0],args[2],args[1],e.public_key_pem,e.spki_sha256,()=>{})).toThrow();
  host.id.service=false;expect(()=>withWindowsServiceSigner(...args,e.public_key_pem,e.spki_sha256,()=>{})).toThrow();
 });
 it.each([{sessionId:1},{interactive:true}])("refuses a non-SCM token %j",diff=>{Object.assign(host.id,diff);expect(()=>prepareWindowsServiceSigner(...args)).toThrow("IDENTITY");});
});
