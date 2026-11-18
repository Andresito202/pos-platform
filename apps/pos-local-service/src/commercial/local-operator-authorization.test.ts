import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CanonicalPermission, CatalogFoodPolicyUpsertRequestSchema, CatalogFoodPolicyUpsertResponseSchema, LicenseSectorEntitlement, AuthorizationCapabilitiesGetResponseSchema, CatalogProductRegisterRequestSchema, CustomerRegisterRequestSchema, InventoryStockReceiveRequestSchema, InventoryStockAdjustRequestSchema, CashShiftOpenRequestSchema, CashShiftCloseRequestSchema, PaymentRegisterCashRequestSchema } from "@pos-platform/contracts";
import type { ServiceConfig } from "../config.js";
import type { CommercialComponent } from "./commercial-component.js";
import { CommercialRequestHandler } from "./commercial-request-handler.js";
import { LocalOperatorSessionRegistry } from "../security/local-operator-session-registry.js";
import type { LocalOperator } from "../security/local-operator-password.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";

import { UpsertFoodPolicyUseCase } from "../catalog/add-presentation-use-case.js";
import { RegisterProductUseCase } from "../catalog/register-product-use-case.js";
import { RegisterCustomerUseCase } from "../customers/register-customer-use-case.js";
import { ReceiveStockUseCase } from "../inventory/receive-stock-use-case.js";
import { AdjustStockUseCase } from "../inventory/adjust-stock-use-case.js";

import { OpenCashShiftUseCase } from "../cash/open-cash-shift-use-case.js";
import { CloseCashShiftUseCase } from "../cash/close-cash-shift-use-case.js";
import { RegisterCashPaymentUseCase } from "../payments/register-cash-payment-use-case.js";

function setup(role: LocalOperator["role"], now: () => number = Date.now, foodLicenseDenial: string | null = null) {
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
  }, now);
  const commercial={
    openCashShift: new OpenCashShiftUseCase(null as never, null as never),
    closeCashShift: new CloseCashShiftUseCase(null as never),
    registerCashPayment: new RegisterCashPaymentUseCase(null as never),
    registerProduct: new RegisterProductUseCase(null as never),
    upsertFoodPolicy: new UpsertFoodPolicyUseCase(null as never),
    requireSectorEntitlement: (entitlement: string) => entitlement === LicenseSectorEntitlement.SALSAMENTARIA ? foodLicenseDenial : null,
    registerCustomer: new RegisterCustomerUseCase(null as never),
    receiveStock: new ReceiveStockUseCase(null as never),
    adjustStock: new AdjustStockUseCase(null as never),
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
  it.each(["LICENSE_ENTITLEMENT_MISSING", "LICENSE_CAPACITY_NOT_PROVISIONED", "LICENSE_REVOKED"])(
    "rejects food policy before accessing storage when %s", async code => {
      const { sessions, handler } = setup("ADMINISTRADOR", Date.now, code);
      await sessions.login("A", "admin.local", "valid");
      const request = CatalogFoodPolicyUpsertRequestSchema.parse({
        protocol_version: "1.0.0", message_type: "catalog.food_policy.upsert",
        request_id: randomUUID(), correlation_id: randomUUID(), operation_id: randomUUID(),
        idempotency_key: randomUUID(), payload_schema_version: "1.0.0",
        payload: { product_id: randomUUID(), conservation_code: "CHILLED", requires_lot_tracking: true, requires_expiry: true, notes: null },
      });
      const response = CatalogFoodPolicyUpsertResponseSchema.parse(handler.handle(request, "A"));
      expect(response).toMatchObject({ status: "REJECTED", result_code: code, result: { outcome: "LICENSE_BLOCKED", version: null } });
    },
  );
  it.each(["CAJERO", "SUPERVISOR", "SUPERADMINISTRADOR"] as const)(
    "rejects food policy write for %s even with a sector licence", async role => {
      const { sessions, handler } = setup(role);
      await sessions.login("A", "operator", "valid");
      const request = CatalogFoodPolicyUpsertRequestSchema.parse({
        protocol_version: "1.0.0", message_type: "catalog.food_policy.upsert",
        request_id: randomUUID(), correlation_id: randomUUID(), operation_id: randomUUID(),
        idempotency_key: randomUUID(), payload_schema_version: "1.0.0",
        payload: { product_id: randomUUID(), conservation_code: "CHILLED", requires_lot_tracking: true, requires_expiry: true, notes: null },
      });
      const response = CatalogFoodPolicyUpsertResponseSchema.parse(handler.handle(request, "A"));
      expect(response).toMatchObject({ status: "REJECTED", result_code: "UNAUTHORIZED" });
    },
  );

  it.each(["SUPERVISOR", "ADMINISTRADOR", "SUPERADMINISTRADOR"] as const)(
    "rejects forged shift open/close and cash collection for %s", async role => {
      const {sessions,handler}=setup(role); await sessions.login("A","operator","valid");
      const base={protocol_version:"1.0.0",payload_schema_version:"1.0.0",
        request_id:randomUUID(),correlation_id:randomUUID(),operation_id:randomUUID(),idempotency_key:randomUUID()};
      const requests=[
        CashShiftOpenRequestSchema.parse({...base,message_type:"cash.shift.open",payload:{
          cash_register_id:randomUUID(),opening_amount:"0.000000",business_date:"2026-11-14",
          timezone_id:"America/Bogota",utc_offset_minutes:-300}}),
        CashShiftCloseRequestSchema.parse({...base,message_type:"cash.shift.close",payload:{
          shift_id:randomUUID(),counted_amount:"0.000000",expected_version:1}}),
        PaymentRegisterCashRequestSchema.parse({...base,message_type:"payment.register.cash",payload:{
          sale_id:randomUUID(),amount:"1000.000000",tendered_amount:"1000.000000"}}),
      ];
      for (const request of requests) expect(handler.handle(request,"A")).toMatchObject({status:"REJECTED",result_code:"UNAUTHORIZED"});
    });
  it.each(["CAJERO", "SUPERVISOR", "ADMINISTRADOR", "SUPERADMINISTRADOR"] as const)(
    "%s loses handler access on expiry, logout and across connections", async role => {
      let now=Date.now(); const {sessions,read}=setup(role,()=>now);
      await sessions.login("A","operator","valid");
      expect(read("A").result_code).toBe("AVAILABLE");
      expect(read("B").result_code).toBe("SESSION_NOT_BOUND");
      now += 8*60*60*1000;
      expect(read("A").result_code).toBe("SESSION_NOT_BOUND");
      await sessions.login("A","operator","valid");
      sessions.logout("A"); expect(read("A").result_code).toBe("SESSION_NOT_BOUND");
    });
  it("local superadmin has exactly audit authority and no GLOBAL licensing grant", async () => {
    const {sessions,read}=setup("SUPERADMINISTRADOR"); await sessions.login("A","operator","valid");
    expect(read("A").result!.permissions).toEqual([CanonicalPermission.AUDIT_EVENT_READ]);
  });
  it.each(["catalog.product.register", "customer.register", "inventory.stock.receive", "inventory.stock.adjust"] as const)(
    "rejects supervisor mutation %s in the handler and real use case before storage", async messageType => {
      const {sessions,handler}=setup("SUPERVISOR");
      await sessions.login("A","supervisor.local","valid");
      const payload = messageType === "catalog.product.register" ? {
        code:"TEST",name:"Producto",stock_controlled:true,presentation_name:"Unidad",
        unit_code:"UND",unit_precision:0,barcode:null,price_amount:"1000.000000",currency_code:"COP",
      } : messageType === "customer.register" ? {
        identification_document_code:"13",identification:"123456789",verification_digit:null,
        legal_organization_code:"2",company:null,names:"Cliente",tribute_code:"ZZ",
        fiscal_responsibility_codes:["R-99-PN"],email:null,phone:null,address:null,
        country_code:"CO",municipality_code:"11001",
      } : {
        presentation_id:randomUUID(),quantity:"1.000000",reason_code:"TEST",
        business_date:"2026-11-13",movement_type:messageType === "inventory.stock.receive" ? "PURCHASE_RECEIPT" : "ADJUSTMENT_NEGATIVE",
      };
      const schema={
        "catalog.product.register":CatalogProductRegisterRequestSchema,
        "customer.register":CustomerRegisterRequestSchema,
        "inventory.stock.receive":InventoryStockReceiveRequestSchema,
        "inventory.stock.adjust":InventoryStockAdjustRequestSchema,
      }[messageType];
      const request=schema.parse({
        protocol_version:"1.0.0",message_type:messageType,request_id:randomUUID(),
        correlation_id:randomUUID(),operation_id:randomUUID(),idempotency_key:randomUUID(),
        payload_schema_version:"1.0.0",payload,
      });
      expect(handler.handle(request,"A")).toMatchObject({status:"REJECTED",result_code:"UNAUTHORIZED"});
    });
  it.each(["SUPERVISOR","ADMINISTRADOR"] as const)("%s receives only its catalog/customer/stock write grants", async role => {
    const {sessions,read}=setup(role); await sessions.login("A","operator","valid");
    const permissions=read("A").result!.permissions;
    for(const code of [CanonicalPermission.CATALOG_PRODUCT_REGISTER,CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER,
      CanonicalPermission.INVENTORY_STOCK_RECEIVE,CanonicalPermission.INVENTORY_STOCK_ADJUST]) {
      expect(permissions.includes(code)).toBe(role === "ADMINISTRADOR");
    }
  });
  it("ADMINISTRADOR gets explicit bakery deviate; SUPERVISOR stays read-only", async () => {
    const admin = setup("ADMINISTRADOR");
    await admin.sessions.login("A", "admin.local", "valid");
    expect(admin.read("A").result!.permissions).toContain(CanonicalPermission.BAKERY_PRODUCTION_DEVIATE);
    expect(admin.read("A").result!.permissions).toContain(CanonicalPermission.BAKERY_PRODUCTION_EXECUTE);
    const supervisor = setup("SUPERVISOR");
    await supervisor.sessions.login("B", "supervisor.local", "valid");
    expect(supervisor.read("B").result!.permissions).toContain(CanonicalPermission.BAKERY_PRODUCTION_READ);
    expect(supervisor.read("B").result!.permissions).not.toContain(CanonicalPermission.BAKERY_PRODUCTION_DEVIATE);
    expect(supervisor.read("B").result!.permissions).not.toContain(CanonicalPermission.BAKERY_PRODUCTION_EXECUTE);
  });
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
  it.each(["SUPERVISOR","ADMINISTRADOR","SUPERADMINISTRADOR"] as const)("denies waiting carts to %s before accessing storage",async role=>{
    const {sessions,handler}=setup(role);await sessions.login("A","operator","valid");
    const response=handler.handle({protocol_version:"1.0.0",message_type:"cart.waiting.list",request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload:{}},"A");
    expect(response).toMatchObject({status:"REJECTED",result_code:"UNAUTHORIZED",result:{carts:[]}});
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
  it("supervisor has read-only catalog, customer and stock permissions",async()=>{
    const {sessions,read}=setup("SUPERVISOR");
    await sessions.login("A","supervisor.local","valid");
    const permissions=read("A").result!.permissions;
    for (const code of [CanonicalPermission.CATALOG_PRODUCT_READ,
      CanonicalPermission.CUSTOMERS_CUSTOMER_READ,CanonicalPermission.INVENTORY_STOCK_READ,
      CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM,CanonicalPermission.PAYMENTS_PAYMENT_CANCEL]) {
      expect(permissions).toContain(code);
    }
    for (const code of [CanonicalPermission.CATALOG_PRODUCT_REGISTER,
      CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER,CanonicalPermission.INVENTORY_STOCK_RECEIVE,
      CanonicalPermission.INVENTORY_STOCK_ADJUST,CanonicalPermission.SALES_SALE_CREATE,
      CanonicalPermission.PAYMENTS_PAYMENT_REGISTER]) {
      expect(permissions).not.toContain(code);
    }
  });
  it("administrator can register stock and issue fiscal documents locally (Wave 7 FACTUS panel)",async()=>{
    const {sessions,read}=setup("ADMINISTRADOR");
    await sessions.login("A","admin.local","valid");
    const permissions=read("A").result!.permissions;
    expect(permissions).toContain(CanonicalPermission.CATALOG_PRODUCT_REGISTER);
    expect(permissions).toContain(CanonicalPermission.INVENTORY_STOCK_RECEIVE);
    expect(permissions).toContain(CanonicalPermission.INVENTORY_STOCK_ADJUST);
    expect(permissions).toContain(CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER);
    // Wave 7: local ADMINISTRADOR may open the fiscal issuance panel. Runtime still
    // fail-closes without deposited FACTUS credential + POS_FISCAL_ENVIRONMENT.
    expect(permissions).toContain(CanonicalPermission.FISCAL_DOCUMENT_ISSUE);
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
  it("cajero cannot forge inventory.stock.adjust", async () => {
    const {sessions,handler,read}=setup("CAJERO");
    await sessions.login("A","cajero.local","valid");
    const permissions=read("A").result!.permissions;
    expect(permissions).not.toContain(CanonicalPermission.AUDIT_EVENT_READ);
    expect(permissions).not.toContain(CanonicalPermission.INVENTORY_STOCK_READ);
    const response=handler.handle(InventoryStockAdjustRequestSchema.parse({
      protocol_version:"1.0.0",
      message_type:"inventory.stock.adjust",
      request_id:randomUUID(),
      correlation_id:randomUUID(),
      operation_id:randomUUID(),
      idempotency_key:randomUUID(),
      payload_schema_version:"1.0.0",
      payload:{
        presentation_id:randomUUID(),
        quantity:"1.000000",
        reason_code:"TEST",
        business_date:"2026-11-13",
        movement_type:"ADJUSTMENT_NEGATIVE",
      },
    }),"A");
    expect(response).toMatchObject({status:"REJECTED",result_code:"UNAUTHORIZED"});
  });
});

