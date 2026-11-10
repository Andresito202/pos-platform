import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CanonicalPermission, AuthorizationCapabilitiesGetResponseSchema } from "@pos-platform/contracts";
import type { ServiceConfig } from "../config.js";
import type { CommercialComponent } from "./commercial-component.js";
import { CommercialRequestHandler } from "./commercial-request-handler.js";
import { LocalOperatorSessionRegistry } from "../security/local-operator-session-registry.js";
import type { LocalOperator } from "../security/local-operator-password.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";

function setup(role: LocalOperator["role"]) {
  const config={
    local_operator_auth_store:"/home/operator/accounts.v1.json",
    tenant_id:randomUUID(),company_id:randomUUID(),branch_id:randomUUID(),
    installation_id:randomUUID(),device_id:randomUUID(),
  } as ServiceConfig;
  const sessions=new LocalOperatorSessionRegistry({
    authenticate:async (_u,_p)=>({status:"AUTHENTICATED",operator:{
      username:role==="ADMINISTRADOR"?"admin.local":role==="CAJERO"?"cajero.local":
        role==="SUPERVISOR"?"supervisor.local":"superadmin.local",
      role,
    }} as const),
  });
  const commercial={
    bindings:{resolve:(_id:string)=>null},
    // Real use case must reject before any store access. A permission regression
    // reaches these absent stores and fails this test instead of writing data.
    createSale: new CreateSaleUseCase(null as never, null as never, null as never, null as never),
  } as unknown as CommercialComponent;
  const handler=new CommercialRequestHandler(config,commercial,id=>sessions.resolve(id));
  const req={
    protocol_version:"1.0.0" as const,
    message_type:"authorization.capabilities.get" as const,
    request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0" as const,payload:{},
  };
  const read=(connection:string)=>{
    const response=AuthorizationCapabilitiesGetResponseSchema.parse(handler.handle(req,connection));
    return response;
  };
  return {sessions,read,handler};
}
describe("local operator backend authorization",()=>{
  it.each(["SUPERVISOR", "ADMINISTRADOR", "SUPERADMINISTRADOR"] as const)("rejects a forged sale.create request from %s in the real use case", async role => {
    const {sessions,handler}=setup(role);
    await sessions.login("A", "operator", "valid");
    const response=handler.handle({
      protocol_version:"1.0.0",message_type:"sale.create",request_id:randomUUID(),
      correlation_id:randomUUID(),idempotency_key:randomUUID(),payload_schema_version:"1.0.0",
      payload:{cash_register_id:randomUUID(),channel:"POS",business_date:"2026-11-09",
        timezone_id:"America/Bogota",utc_offset_minutes:-300,document_series:"POS",currency_code:"COP",
        lines:[{product_id:randomUUID(),presentation_id:randomUUID(),quantity:"1.000000"}]},
    }, "A");
    expect(response).toMatchObject({status:"REJECTED",result_code:"UNAUTHORIZED"});
  });
  it.each(["SUPERVISOR", "ADMINISTRADOR"] as const)("%s reviews payments without inheriting cashier operations", async role => {
    const {sessions,read}=setup(role);
    await sessions.login("A", role === "SUPERVISOR" ? "supervisor.local" : "admin.local", "valid");
    const permissions=read("A").result!.permissions;
    for (const code of [CanonicalPermission.SALES_SALE_CREATE, CanonicalPermission.CASH_SHIFT_OPEN,
      CanonicalPermission.CASH_SHIFT_CLOSE, CanonicalPermission.PAYMENTS_PAYMENT_REGISTER,
      CanonicalPermission.PAYMENTS_TRANSFER_REPORT]) expect(permissions).not.toContain(code);
    expect(permissions).toContain(CanonicalPermission.PAYMENTS_PAYMENT_READ);
    expect(permissions).toContain(CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM);
    expect(permissions).toContain(CanonicalPermission.PAYMENTS_PAYMENT_CANCEL);
    expect(permissions).toContain(CanonicalPermission.INVENTORY_STOCK_READ);
  });
  it("does not authorize a connection before password login or across sockets",async()=>{
    const {sessions,read}=setup("ADMINISTRADOR");
    expect(read("A").status).toBe("REJECTED");
    await sessions.login("A","admin.local","valid");
    expect(read("A").result_code).toBe("AVAILABLE");
    expect(read("B").result_code).toBe("SESSION_NOT_BOUND");
    sessions.logout("A");
    expect(read("A").result_code).toBe("SESSION_NOT_BOUND");
  });
  it("cajero cannot manage catalog or stock but can sell",async()=>{
    const {sessions,read}=setup("CAJERO");
    await sessions.login("A","cajero.local","valid");
    const permissions=read("A").result!.permissions;
    expect(permissions).toContain(CanonicalPermission.SALES_SALE_CREATE);
    expect(permissions).toContain(CanonicalPermission.CATALOG_PRODUCT_READ);
    expect(permissions).not.toContain(CanonicalPermission.CATALOG_PRODUCT_REGISTER);
    expect(permissions).not.toContain(CanonicalPermission.INVENTORY_STOCK_ADJUST);
    expect(permissions).not.toContain(CanonicalPermission.FISCAL_DOCUMENT_ISSUE);
  });
  it("administrator can register stock, but local credentials cannot issue fiscal invoices",async()=>{
    const {sessions,read}=setup("ADMINISTRADOR");
    await sessions.login("A","admin.local","valid");
    const permissions=read("A").result!.permissions;
    expect(permissions).toContain(CanonicalPermission.CATALOG_PRODUCT_REGISTER);
    expect(permissions).toContain(CanonicalPermission.INVENTORY_STOCK_RECEIVE);
    expect(permissions).not.toContain(CanonicalPermission.FISCAL_DOCUMENT_ISSUE);
    expect(permissions).not.toContain(CanonicalPermission.LICENSE_PLAN_MANAGE);
  });
  it("superadmin local is not silently promoted to a cashier",async()=>{
    const {sessions,read}=setup("SUPERADMINISTRADOR");
    await sessions.login("A","superadmin.local","valid");
    const permissions=read("A").result!.permissions;
    expect(permissions).not.toContain(CanonicalPermission.SALES_SALE_CREATE);
    expect(permissions).not.toContain(CanonicalPermission.CATALOG_PRODUCT_REGISTER);
    expect(permissions).not.toContain(CanonicalPermission.LICENSE_PLAN_MANAGE);
  });
});

