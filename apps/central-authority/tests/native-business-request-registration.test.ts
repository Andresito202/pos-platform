import { describe,it,expect,vi } from "vitest";
import type { IncomingMessage,ServerResponse } from "node:http";
import { createNativeRequestHandler } from "../src/native-business-request-registration.js";
describe("native registration unprovisioned boundary",()=>{
  it("fails closed and does not intercept portal routes",async()=>{
    const handler=createNativeRequestHandler();
    const writeHead=vi.fn(),end=vi.fn();
    const res={writeHead,end} as unknown as ServerResponse;
    for(const url of ["/v1/commercial/native-request-challenges","/v1/commercial/native-requests"]){
      expect(await handler({url,method:"POST"} as IncomingMessage,res)).toBe(true);
      expect(writeHead.mock.lastCall?.[0]).toBe(503);
    }
    expect(await handler({url:"/v1/commercial/merchant-destinations/snapshot",method:"POST"} as IncomingMessage,res)).toBe(false);
  });
});
