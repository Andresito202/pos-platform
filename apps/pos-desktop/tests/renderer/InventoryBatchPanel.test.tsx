// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {InventoryBatchPanel} from "../../renderer/src/components/InventoryBatchPanel.js";
import {RENDERER_API_METHODS} from "../../src/preload-api.js";
const id="018f0000-0000-7000-8000-000000000001";
const lot="018f0000-0000-7000-8000-000000000002";
const calls:Array<{name:string;payload:any}>=[];
const base={outcome:"FOUND" as const,tracked:true,batches:[{
 id:lot,batch_code:"L-01",quantity_on_hand:"3.000000",status:"AVAILABLE",
 manufacture_date:null,expiry_date:"2026-12-15",
 supplier_reference:"LAB-01",receipt_document:"INV-01",
}]};
function install(writeOk=true){
 const svc:Record<string,(p:any)=>Promise<unknown>>={};
 for(const name of RENDERER_API_METHODS)svc[name]=async (payload:any)=>{
   calls.push({name,payload});
   if(name==="inventory.batch.list")return {status:"SUCCEEDED",result_code:"FOUND",result:base};
   if(name==="inventory.batch.status"){
     if(!writeOk)throw Error("network uncertain");
     return {status:"SUCCEEDED",result_code:"UPDATED",result:{outcome:"UPDATED"}};
   }
   return {status:"REJECTED",result_code:"NOT_AVAILABLE",result:null};
 };
 Object.defineProperty(window,"posService",{value:svc,configurable:true,writable:true});
}
beforeEach(()=>{calls.length=0;});
afterEach(()=>cleanup());
describe("Original inventory panel batch controls",()=>{
 it("shows company-scoped batch balances but no write action without adjust permission",async()=>{
   install();
   render(<InventoryBatchPanel presentationId={id} canAdjust={false}/>);
   fireEvent.click(screen.getByText("Consultar lotes"));
   await screen.findByRole("cell",{name:"L-01"});
   expect(screen.getByText("3.000000")).toBeTruthy();
   expect(screen.queryByText("Registrar estado")).toBeNull();
   expect(calls.every(c=>c.name!=="inventory.batch.status")).toBe(true);
 });
 it("issues exactly one status update with no stock adjustment or sale operation",async()=>{
   install();
   render(<InventoryBatchPanel presentationId={id} canAdjust/>);
   fireEvent.click(screen.getByText("Consultar lotes"));
   await screen.findByRole("cell",{name:"L-01"});
   fireEvent.change(screen.getByLabelText("Lote"),{target:{value:lot}});
   fireEvent.click(screen.getByText("Registrar estado"));
   await waitFor(()=>expect(calls.some(c=>c.name==="inventory.batch.status")).toBe(true));
   expect(calls.some(c=>c.name==="inventory.stock.adjust"||c.name==="sale.create")).toBe(false);
   expect(calls.find(c=>c.name==="inventory.batch.status")?.payload?.payload).toMatchObject({
     lot_id:lot,status:"QUARANTINE",reason_code:"QUALITY_REVIEW",
   });
 });
 it("keeps one idempotency key across unknown-result retries",async()=>{
   install(false);
   render(<InventoryBatchPanel presentationId={id} canAdjust/>);
   fireEvent.click(screen.getByText("Consultar lotes"));
   await screen.findByRole("cell",{name:"L-01"});
   fireEvent.change(screen.getByLabelText("Lote"),{target:{value:lot}});
   fireEvent.click(screen.getByText("Registrar estado"));
   await screen.findByText(/Sin respuesta del servicio/);
   fireEvent.click(screen.getByText("Reintentar el mismo cambio pendiente"));
   await waitFor(()=>expect(calls.filter(c=>c.name==="inventory.batch.status").length).toBe(2));
   const writes=calls.filter(c=>c.name==="inventory.batch.status");
   expect(writes[0]?.payload.idempotency_key).toEqual(writes[1]?.payload.idempotency_key);
   expect(writes[0]?.payload.payload).toEqual(writes[1]?.payload.payload);
 });
});
