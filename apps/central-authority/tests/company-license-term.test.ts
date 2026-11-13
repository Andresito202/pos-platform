import {it,expect} from "vitest";
import {companyLicenseTermState as state} from "../src/company-license-contract-reader.js";
const from=new Date('2026-10-01T00:00:00Z'),until=new Date('2026-11-01T00:00:00Z');
it.each([
  ['ACTIVE','2026-09-30T23:59:59Z','NOT_STARTED'],
  ['ACTIVE','2026-10-31T23:59:59Z','CURRENT'],
  ['ACTIVE','2026-11-01T00:00:00Z','GRACE'],
  ['ACTIVE','2026-11-03T23:59:59Z','GRACE'],
  ['ACTIVE','2026-11-04T00:00:00Z','EXPIRED'],
  ['PAST_DUE','2026-11-01T00:00:00Z','GRACE'],
  ['PAST_DUE','2026-11-03T23:59:59.999Z','GRACE'],
  ['PAST_DUE','2026-11-04T00:00:00Z','EXPIRED'],
  ['SUSPENDED','2026-10-15T00:00:00Z','NOT_CURRENT'],
  ['CANCELLED','2026-10-15T00:00:00Z','NOT_CURRENT'],
])('read state %s at %s = %s',(status,at,expected)=>expect(state(status,from,until,new Date(at),3)).toBe(expected));
it('perpetual use has no time expiry; bad dates/policy never become current',()=>{
  expect(state('ACTIVE',from,null,new Date('2035-01-01T00:00:00Z'),3)).toBe('CURRENT');
  expect(()=>state('ACTIVE',from,until,new Date('invalid'),3)).toThrow();
  expect(()=>state('ACTIVE',from,until,from,0 as 3)).toThrow();
});

it("does not grant perpetual validity to a past-due contract",()=>expect(state("PAST_DUE",from,null,until,3)).toBe("NOT_CURRENT"));
