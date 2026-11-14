import {it,expect} from "vitest";
import {CamachoCommercialDomains as d,camachoBusinessLoginNavigation} from "../src/commercial-domains.js";
it("owner destinations are exact, do not register redirects or allow arbitrary return URLs",()=>{
  expect(d.publicOrigin).toBe('https://camachoposcolombia.com');expect(d.centralOrigin).toBe('https://central.camachoposcolombia.com');
  expect(camachoBusinessLoginNavigation('a'.repeat(43))).toBe(d.centralOrigin+'/v1/commercial/login?request='+'a'.repeat(43));
  for(const value of ['https://evil.invalid','a'.repeat(43)+'&redirect_uri=https://evil.invalid','a'.repeat(42),'a'.repeat(43)+'#x'])expect(()=>camachoBusinessLoginNavigation(value)).toThrow();
  expect(d.centralOrigin+d.factusPayWebhookPath).toBe('https://central.camachoposcolombia.com/v1/webhooks/factus-pay/collections');
});
