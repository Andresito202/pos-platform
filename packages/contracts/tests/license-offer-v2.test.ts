import {it,expect} from "vitest";
import {LicenseOfferV2Schema,LicenseOfferDraftSchema,parseCopPesos,formatCopPesos,previewLicenseOffer,addLicenseCalendarMonths} from "../src/license-offer.js";
import {uuidV7} from "../src/uuid-v7.js";
const offer=(model:"MONTHLY"|"ANNUAL"|"PERPETUAL",base:number,extra:number,support:number)=>LicenseOfferV2Schema.parse({
  id:uuidV7(),code:"TEST_"+model,name:model,billing_model:model,deployment_mode:model==='PERPETUAL'?"LOCAL_PERPETUAL":"HYBRID",
  currency_code:"COP",currency_exponent:2,price_minor:base*100,additional_register_price_minor:extra*100,support_price_minor:support*100,
  included_registers:1,support_charge:model==='PERPETUAL'?"OPTIONAL_12_MONTHS":"OPTIONAL_SAME_TERM",support_term_months:model==='MONTHLY'?1:12,
  profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION",policy_reference:"TEST_ONLY"});
it("COP exact scale, human separators, rejection and overflow",()=>{
  expect(parseCopPesos("49.900")).toBe(4990000);expect(parseCopPesos("49900,50")).toBe(4990050);
  expect(formatCopPesos(4990050)).toBe("49.900,50");expect(formatCopPesos(0)).toBe("0");
  for(const input of ["49.90","1,234","1e4","-1"," 49900","49,900.00","90071992547410"])
    expect(()=>parseCopPesos(input)).toThrow();
});
it.each([
  ["MONTHLY",49900,19900,14900,49900,89700],
  ["ANNUAL",499000,199000,149000,499000,897000],
  ["PERPETUAL",1490000,490000,249000,1490000,2470000],
] as const)("%s one or three registers, exact six approved previews",(model,base,extra,support,one,three)=>{
  const p=offer(model,base,extra,support);
  expect(previewLicenseOffer(p,{additional_registers:0,support:false},1).subtotal_minor).toBe(one*100);
  expect(previewLicenseOffer(p,{additional_registers:2,support:false},1).subtotal_minor).toBe(three*100);
  const supported=previewLicenseOffer(p,{additional_registers:2,support:true},1);
  expect(supported.subtotal_minor).toBe((three+support)*100);expect(supported.support_term_months).toBe(model==='MONTHLY'?1:12);
  expect(supported.activation_status).toBe("NOT_ACTIVATED");
  expect(()=>previewLicenseOffer({...p,additional_register_price_minor:Number.MAX_SAFE_INTEGER},{additional_registers:2,support:false},1)).toThrow("OVERFLOW");
});
it("calendar month/year clamp and legacy values retain their meaning",()=>{
  expect(addLicenseCalendarMonths("2028-01-31T10:20:30.000Z",1)).toBe("2028-02-29T10:20:30.000Z");
  expect(addLicenseCalendarMonths("2028-02-29T10:20:30.000Z",12)).toBe("2029-02-28T10:20:30.000Z");
  const p=offer("PERPETUAL",1490000,490000,249000);
  expect(LicenseOfferV2Schema.safeParse({...p,support_charge:"OPTIONAL_SAME_TERM"}).success).toBe(false);
  expect(LicenseOfferV2Schema.safeParse({...p,currency_exponent:0}).success).toBe(false);
  const {profile:_,currency_exponent:__,publication_scope:___,support_term_months:____,...legacy}=p;
  expect(LicenseOfferDraftSchema.parse({...legacy,price_minor:223000,support_charge:"OPTIONAL_SAME_TERM"}).price_minor).toBe(223000);
});
