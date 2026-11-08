// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
import {MerchantPaymentNoticePanel} from "../../renderer/src/components/MerchantPaymentNoticePanel.js";
import {MerchantNoticesGetRequestSchema} from "@pos-platform/contracts";

afterEach(()=>{cleanup();});
const sample={
 id:"01900000-0000-7000-8000-000000000031",
 received_at:"2026-11-07T12:00:00.000Z",
 reported_amount_cop:4500,payer_display:"Juan Pérez",
 status:"UNVERIFIED",bank_confirmed:false,sale_confirmed:false,
};
function setup(items:unknown[],available=true){
 const calls:unknown[]=[];
 Object.defineProperty(window,"posService",{configurable:true,value:{
  "payment.notice.get":async(payload:unknown)=>{
    calls.push(payload);
    return {status:available?"SUCCEEDED":"REJECTED",result_code:available?"AVAILABLE":"UNAVAILABLE",
      result:{outcome:available?"AVAILABLE":"UNAVAILABLE",checked_at:available?new Date().toISOString():null,notices:available?items:[]}};
  },
 }});
 return calls;
}
describe("QR-002 cashier comparison is informational only",()=>{
 it("shows SMS reported $4,500 and claimed payer, not the requested $5,000",async()=>{
  const calls=setup([sample]);
  render(<MerchantPaymentNoticePanel enabled amount="5000.000000"/>);
  await screen.findByTestId("merchant-notice-item");
  const text=screen.getByTestId("merchant-notice-item").textContent??"";
  expect(text).toContain("4.500");
  expect(text).toContain("Juan Pérez");
  expect(text).toMatch(/inferior/i);
  expect(text).toContain("500");
  expect(text).toMatch(/SIN VERIFICAR EN EL BANCO/);
  expect(calls).toHaveLength(1);
  expect(()=>MerchantNoticesGetRequestSchema.parse(calls[0])).not.toThrow();
  expect(screen.getByText(/no confirman ni completan ventas/i)).toBeTruthy();
 });
 it("matching amount is never treated as bank proof or auto-matched to a sale",async()=>{
  setup([sample]);
  render(<MerchantPaymentNoticePanel enabled amount="4500.000000"/>);
  await screen.findByTestId("merchant-notice-item");
  expect(screen.getByText(/igual al solicitado, pero NO demuestra pago de esta venta/i)).toBeTruthy();
 });
 it("does not replace missing bank SMS amount or payer with cashier requested value",async()=>{
  setup([{...sample,reported_amount_cop:null,payer_display:null}]);
  render(<MerchantPaymentNoticePanel enabled amount="4500.000000"/>);
  await screen.findByTestId("merchant-notice-item");
  const text=screen.getByTestId("merchant-notice-item").textContent??"";
  expect(text).toContain("Aviso sin importe informado");
  expect(text).toContain("pagador no identificado");
  expect(text).toMatch(/No es posible comparar/);
 });
 it("hides old/bad feed and fails closed when Central unreachable",async()=>{
  setup([],false);
  render(<MerchantPaymentNoticePanel enabled amount="4500.000000"/>);
  await waitFor(()=>expect(screen.getByText(/No hay conexión verificada/i)).toBeTruthy());
  expect(screen.queryByTestId("merchant-notice-item")).toBeNull();
 });
 it("never queries a financial notification before the cashier view is enabled",()=>{
  const calls=setup([sample]);
  render(<MerchantPaymentNoticePanel enabled={false} amount="4500.000000"/>);
  expect(calls).toHaveLength(0);
 });
});
