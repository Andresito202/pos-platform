// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {afterEach} from "vitest";
import {MerchantDestinationsGetRequestSchema} from "@pos-platform/contracts";
import {MerchantPaymentMethods} from "../../renderer/src/components/MerchantPaymentMethods.js";
import {RENDERER_API_METHODS} from "../../src/preload-api.js";

const calls=new Map<string,unknown[]>();
function install(reply:unknown){
  const service:Record<string,(p:unknown)=>Promise<unknown>>={};
  for(const name of RENDERER_API_METHODS){
    service[name]=async(payload:unknown)=>{
      calls.set(name,[...(calls.get(name)??[]),payload]);
      return name==="payment.destination.get"?reply:{status:"REJECTED",result_code:"NOT_AVAILABLE",result:null};
    };
  }
  Object.defineProperty(window,"posService",{value:service,configurable:true,writable:true});
}
beforeEach(()=>calls.clear());
afterEach(()=>cleanup());
describe("QR-001 cashier read-only display",()=>{
 it("shows bank-provided signed PNG and Nequi number without making a payment",async()=>{
   const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(52)]).toString("base64");
   install({status:"SUCCEEDED",result_code:"AVAILABLE",result:{
    outcome:"AVAILABLE",sequence:7,
    destinations:[{kind:"NEQUI_BUSINESS_QR",label:"QR Negocios",destination_reference:"@empresa",
      qr_asset_id:"77777777-7777-4777-8777-777777777777",qr_sha256:"a".repeat(64),version:2,
      qr_png_base64:png},
      {kind:"NEQUI_NUMBER",label:"Nequi",destination_reference:"3001234567",
       qr_asset_id:null,qr_sha256:null,version:1}]
   }});
   render(<MerchantPaymentMethods enabled amount="45000.000000"/>);
   await screen.findByTestId("destination-NEQUI_BUSINESS_QR");
   expect(screen.getByAltText("QR de cobro proporcionado por el comercio")).toBeTruthy();
   expect(screen.getAllByTestId("merchant-destination-reference")).toHaveLength(2);
   expect(screen.getByText(/pendiente de verificación/i)).toBeTruthy();
   const req=calls.get("payment.destination.get")?.[0];
   expect(()=>MerchantDestinationsGetRequestSchema.parse(req)).not.toThrow();
   expect(calls.has("payment.transfer.confirm")).toBe(false);
   expect(calls.has("payment.register.cash")).toBe(false);
 });
 it("shows Bre-B bank QR alongside its key without generating payment intent",async()=>{
   const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(52)]).toString("base64");
   install({status:"SUCCEEDED",result_code:"AVAILABLE",result:{
     outcome:"AVAILABLE",sequence:8,destinations:[{
       kind:"BREB_KEY",label:"Bre-B negocio",destination_reference:"@3001234567",
       qr_asset_id:"88888888-8888-4888-8888-888888888888",
       qr_sha256:"b".repeat(64),qr_png_base64:png,version:1,
     }],
   }});
   render(<MerchantPaymentMethods enabled amount="45000.000000"/>);
   await screen.findByTestId("destination-BREB_KEY");
   expect(screen.getByAltText("QR de cobro proporcionado por el comercio")).toBeTruthy();
   expect(screen.getByTestId("merchant-destination-reference").textContent).toBe("@3001234567");
   expect(calls.has("payment.transfer.confirm")).toBe(false);
 });
 it("does not access customer financial info without read permission",()=>{
   install({status:"SUCCEEDED",result_code:"AVAILABLE",result:null});
   const view=render(<MerchantPaymentMethods enabled={false} amount="1"/>);
   expect(view.container.querySelector("section")).toBeNull();
   expect(calls.has("payment.destination.get")).toBe(false);
 });
 it("fails closed on missing or expired company snapshot",async()=>{
   install({status:"REJECTED",result_code:"UNAVAILABLE",result:{
    outcome:"UNAVAILABLE",sequence:null,destinations:[],
   }});
   render(<MerchantPaymentMethods enabled amount="6000.000000"/>);
   await screen.findByTestId("merchant-payment-unavailable");
   expect(screen.queryByAltText("QR de cobro proporcionado por el comercio")).toBeNull();
 });
 it("supports manual refresh without modifying destination",async()=>{
   install({status:"SUCCEEDED",result_code:"AVAILABLE",result:{
    outcome:"AVAILABLE",sequence:1,destinations:[]
   }});
   render(<MerchantPaymentMethods enabled amount="0"/>);
   await screen.findByText("El administrador no ha publicado un destino de cobro.");
   fireEvent.click(screen.getByTestId("refresh-merchant-destinations"));
   await waitFor(()=>expect(calls.get("payment.destination.get")?.length).toBe(2));
   expect(calls.has("payment.destination.publish")).toBe(false);
 });
});
