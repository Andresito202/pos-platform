import {describe,expect,it} from "vitest";
import {decodeScmCapsulePrefix} from "../src/windows-scm-client.js";

function capsuleFrame(value:unknown):Buffer{
 const body=Buffer.from(JSON.stringify(value),"utf8");
 const header=Buffer.alloc(4);header.writeUInt32BE(body.length);
 return Buffer.concat([header,body]);
}
describe("SCM signed capsule byte-stream prefix",()=>{
 it("accepts split headers and split UTF-8 payloads without guessing message boundaries",()=>{
  const frame=capsuleFrame({version:2,capsule:{name:"credencial"},signed_at:"2026-10-30"});
  for(let n=0;n<frame.length;n++){
   expect(decodeScmCapsulePrefix(frame.subarray(0,n))).toEqual({complete:false});
  }
  const result=decodeScmCapsulePrefix(frame);
  expect(result).toEqual({complete:true,capsule:{version:2,capsule:{name:"credencial"},signed_at:"2026-10-30"},consumed:frame.length});
 });
 it("preserves the exact first IPC frame when Windows coalesces both writes",()=>{
  const frame=capsuleFrame({version:2});
  const next=Buffer.from([0,0,0,4,0xde,0xad,0xbe,0xef]);
  const joined=Buffer.concat([frame,next]);
  const result=decodeScmCapsulePrefix(joined);
  if(!result.complete)throw Error("prefix should be complete");
  expect(result.consumed).toBe(frame.length);
  expect(joined.subarray(result.consumed)).toEqual(next);
 });
 it("rejects zero-length, oversized, malformed JSON and invalid UTF-8",()=>{
  expect(()=>decodeScmCapsulePrefix(Buffer.from([0,0,0,0]))).toThrow("SCM_HANDOFF_DELIVERY_REJECTED");
  expect(()=>decodeScmCapsulePrefix(Buffer.from([0,0,128,1]))).toThrow("SCM_HANDOFF_DELIVERY_REJECTED");
  expect(()=>decodeScmCapsulePrefix(Buffer.from([0,0,0,1,0xff]))).toThrow();
  expect(()=>decodeScmCapsulePrefix(Buffer.from([0,0,0,1,0x7b]))).toThrow();
 });
});
