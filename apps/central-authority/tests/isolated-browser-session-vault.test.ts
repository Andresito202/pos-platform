import {describe,expect,it} from "vitest";
import {IsolatedBrowserSessionVault} from "../src/isolated-browser-session-vault.js";

const origin="https://login.example.test";
const context=(setCookie:string,csrfToken:string,changes:Record<string,string|null>={})=>({
  cookie:setCookie.split(";")[0]!,origin,csrfToken,fetchSite:"same-origin",method:"POST",
  ...changes,
});
describe("isolated browser session vault",()=>{
  it("creates secure host-only HttpOnly cookie without exposing reference",()=>{
    const vault=new IsolatedBrowserSessionVault(origin),reference=Object.freeze({kind:"protected"});
    const issued=vault.establish(reference,origin)!;
    expect(issued.setCookie).toMatch(/^__Host-camacho_business=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=300$/);
    expect(issued.setCookie).not.toContain("kind");
    expect(issued.setCookie).not.toContain(issued.csrfToken);
    expect(vault.inspect(context(issued.setCookie,issued.csrfToken))).toBe(reference);
  });
  it("denies forged origin, CSRF, cross-site request and unsupported method",()=>{
    const vault=new IsolatedBrowserSessionVault(origin);
    const issued=vault.establish({},origin)!;
    for(const patch of [
      {origin:"https://evil.example.test"},
      {csrfToken:"z".repeat(43)},
      {fetchSite:"cross-site"},
      {fetchSite:null},
      {method:"GET"},
    ])expect(vault.inspect(context(issued.setCookie,issued.csrfToken,patch))).toBeNull();
  });
  it("rejects duplicate cookie names and forged cookie values",()=>{
    const vault=new IsolatedBrowserSessionVault(origin);
    const issued=vault.establish({},origin)!;
    expect(vault.inspect(context(issued.setCookie,issued.csrfToken,{
      cookie:issued.setCookie.split(";")[0]+"; "+issued.setCookie.split(";")[0],
    }))).toBeNull();
    expect(vault.inspect(context(issued.setCookie,issued.csrfToken,{
      cookie:"__Host-camacho_business="+"x".repeat(43),
    }))).toBeNull();
  });
  it("rotates cookie and CSRF without allowing the previous ID to be reused",()=>{
    const vault=new IsolatedBrowserSessionVault(origin),ref={kind:"session"};
    const original=vault.establish(ref,origin)!;
    const updated=vault.rotate(context(original.setCookie,original.csrfToken))!;
    expect(updated.setCookie).not.toBe(original.setCookie);
    expect(vault.inspect(context(original.setCookie,original.csrfToken))).toBeNull();
    expect(vault.inspect(context(updated.setCookie,updated.csrfToken))).toBe(ref);
  });
  it("expires and denies the session on the trusted clock",()=>{
    let clock=2000;
    const vault=new IsolatedBrowserSessionVault(origin,()=>clock);
    const issued=vault.establish({},origin)!;
    clock+=300_000;
    expect(vault.inspect(context(issued.setCookie,issued.csrfToken))).toBeNull();
  });
  it("logs out and removes the session with an expired replacement cookie",()=>{
    const vault=new IsolatedBrowserSessionVault(origin);
    const issued=vault.establish({},origin)!;
    const closed=vault.logout(context(issued.setCookie,issued.csrfToken));
    expect(closed?.clearCookie).toContain("Max-Age=0");
    expect(vault.inspect(context(issued.setCookie,issued.csrfToken))).toBeNull();
  });
  it("rejects non-HTTPS, local origins and invalid establishment",()=>{
    expect(()=>new IsolatedBrowserSessionVault("http://login.example.test")).toThrow();
    expect(()=>new IsolatedBrowserSessionVault("https://localhost")).toThrow();
    expect(new IsolatedBrowserSessionVault(origin).establish({}, "https://evil.example.test")).toBeNull();
  });
});