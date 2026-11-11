// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFiscalIssuance } from "../../renderer/src/hooks/useFiscalIssuance.js";
const call=vi.hoisted(()=>vi.fn());
vi.mock("../../renderer/src/pos-service.js",()=>({callCommercial:call,newIdempotencyKey:()=>"fixture-key"}));
const customer={kind:"IDENTIFIED" as const,customerId:"018f0000-0000-7000-8000-000000000001"};
const uncertain={status:"REJECTED",result_code:"UNCERTAIN",result:{outcome:"UNCERTAIN",document_id:null,transport_status:"UNKNOWN_OUTCOME",normalized_result:null,cufe:null,issued_prefix:null,issued_number:null,attempt_count:1,block_code:null,reasons:[]}};
beforeEach(()=>{call.mockReset();});
describe("fiscal uncertain results",()=>{
 it.each([{...uncertain,result_code:"FISCAL_REJECTED",result:{...uncertain.result,outcome:"FISCAL_REJECTED",transport_status:"COMPLETED",normalized_result:"REJECTED"}},uncertain,{...uncertain,result_code:"REQUIRES_RECONCILIATION",result:{...uncertain.result,outcome:"REQUIRES_RECONCILIATION"}},{...uncertain,status:"SUCCEEDED"},{status:"UNKNOWN",result_code:"UNKNOWN",result:null}])("blocks reissue per sale, including malformed status: %j",async response=>{
  call.mockResolvedValue(response);const {result}=renderHook(()=>useFiscalIssuance());
  await act(async()=>{await result.current.issue("sale-a","SALES_INVOICE",customer);});
  expect(result.current.isBlocked("sale-a","SALES_INVOICE")).toBe(true);
  await act(async()=>{await result.current.issue("sale-a","SALES_INVOICE",customer);});expect(call).toHaveBeenCalledTimes(1);
  expect(result.current.isBlocked("sale-b","SALES_INVOICE")).toBe(false);
  await act(async()=>{await result.current.issue("sale-b","SALES_INVOICE",customer);});expect(call).toHaveBeenCalledTimes(2);
 });
 it("blocks after lost response and suppresses double submission",async()=>{
  let reject!:(error:Error)=>void;call.mockImplementation(()=>new Promise((_,no)=>{reject=no;}));
  const {result}=renderHook(()=>useFiscalIssuance());let first!:Promise<void>;
  act(()=>{first=result.current.issue("sale-a","SALES_INVOICE",customer);void result.current.issue("sale-a","SALES_INVOICE",customer);});
  expect(call).toHaveBeenCalledTimes(1);
  await act(async()=>{reject(Error("lost response"));await first;});
  expect(result.current.isBlocked("sale-a","SALES_INVOICE")).toBe(true);expect(result.current.issued).toBeNull();
 });
});
