import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const main=readFileSync(new URL("../src/main.ts",import.meta.url),"utf8");
const routeStart=main.indexOf('if(commercialHandler&&(request.url?.startsWith("/v1/commercial/")');
const routeEnd=main.indexOf('if(request.url?.split("?",1)[0]===FACTUS_PAY_COLLECTION_WEBHOOK_PATH)',routeStart);
const route=main.slice(routeStart,routeEnd);

describe("Central BUSINESS HTTPS dispatcher (non-network security regression)",()=>{
  it("awaits the exact existing commercial handler instead of fire-and-forget",()=>{
    expect(routeStart).toBeGreaterThan(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    expect(route).toContain("await commercialHandler(request,response)");
    expect(route).not.toMatch(/(?<!await )commercialHandler\(request,response\)/);
  });
  it("contains an asynchronous failure with a generic no-store response",()=>{
    expect(route).toContain("try{");
    expect(route).toContain("}catch{");
    expect(route).toContain("if(response.headersSent)");
    expect(route).toContain("response.destroy()");
    expect(route).toContain("send(response,500");
    expect(route).toContain("COMMERCIAL_REQUEST_FAILED");
    expect(main).toContain('"cache-control": "no-store"');
  });
  it("never propagates passwords, proofs or exception strings into error output",()=>{
    expect(route).not.toContain("console.error(error)");
    expect(route).not.toContain("error.message");
    expect(route).not.toContain("JSON.stringify(error)");
    expect(route).toContain('process.stderr.write("CENTRAL_COMMERCIAL_REQUEST_FAILED\\n")');
    expect(route).toContain("return;");
  });
});
