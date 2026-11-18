import {it,expect} from "vitest";
import {validateWindowsCommercialRegistration,validateCommercialHttpsOrigin} from "../src/native-client-registration.js";
// Metadata validation only; this hostname is never configured or contacted.
const origin="https://auth.operator-domain.co",registration={clientId:"desktop-client",authorizationOrigin:origin,redirectUri:"http://127.0.0.1:42133/callback",platform:"ELECTRON" as const};
it("retains exact Windows registration, HTTPS origin and an explicit compatible RP",()=>{
  expect(validateWindowsCommercialRegistration(registration,"auth.operator-domain.co",origin).registration).toEqual(registration);
  expect(validateWindowsCommercialRegistration(registration,"operator-domain.co",origin).rpId).toBe("operator-domain.co");
});
it.each(["http://auth.operator-domain.co","https://business.example.test","https://127.0.0.1","https://example.com","https://localhost","https://auth.operator-domain.co/path"])("rejects insecure, reserved or non-origin value %s",value=>{
  expect(()=>validateCommercialHttpsOrigin(value)).toThrow();
});
it.each(["", "other-domain.co","co","operator-domain.co:443"])("rejects incompatible RP %s",rp=>{
  expect(()=>validateWindowsCommercialRegistration(registration,rp,origin)).toThrow();
});
it("rejects client/redirect/origin mismatch without inventing defaults",()=>{
  for(const changes of [{clientId:""},{redirectUri:"http://localhost:42133/callback"},{redirectUri:"http://127.0.0.1:42133/other"}])
    expect(()=>validateWindowsCommercialRegistration({...registration,...changes},"auth.operator-domain.co",origin)).toThrow();
  expect(()=>validateWindowsCommercialRegistration(registration,"auth.operator-domain.co","https://other.operator-domain.co")).toThrow();
});
