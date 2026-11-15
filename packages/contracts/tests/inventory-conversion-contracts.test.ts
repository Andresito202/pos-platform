import { describe,it,expect } from "vitest";
import {
  IpcRequestSchema,InventoryConversionRuleApproveRequestSchema,
  InventoryConversionExecuteRequestSchema,
} from "../src/index.js";

const ids={
  request:"018f0000-0000-7000-8000-000000000001",
  correlation:"018f0000-0000-7000-8000-000000000002",
  operation:"018f0000-0000-7000-8000-000000000003",
  source:"018f0000-0000-7000-8000-000000000004",
  target:"018f0000-0000-7000-8000-000000000005",
  rule:"018f0000-0000-7000-8000-000000000006",
};
const base={
  protocol_version:"1.0.0",request_id:ids.request,
  correlation_id:ids.correlation,operation_id:ids.operation,
  payload_schema_version:"1.0.0",idempotency_key:"conversion-test-001",
};
describe("original POS IPC conversion contracts",()=>{
  const approval={...base,message_type:"inventory.conversion.rule.approve",payload:{
    source_presentation_id:ids.source,target_presentation_id:ids.target,
    numerator:"12",denominator:"1",version:1,
  }};
  it("routes a strict approved ratio without accepting caller identity",()=>{
    expect(InventoryConversionRuleApproveRequestSchema.safeParse(approval).success).toBe(true);
    expect(IpcRequestSchema.safeParse(approval).success).toBe(true);
    expect(IpcRequestSchema.safeParse({...approval,company_id:ids.source}).success).toBe(false);
    expect(IpcRequestSchema.safeParse({...approval,payload:{...approval.payload,denominator:"0"}}).success).toBe(false);
    expect(IpcRequestSchema.safeParse({...approval,payload:{...approval.payload,unknown:true}}).success).toBe(false);
  });
  const conversion={...base,message_type:"inventory.conversion.execute",payload:{
    rule_id:ids.rule,source_lot_id:ids.source,quantity:"2.000000",
    reason_code:"PRESENTATION_CONVERSION",business_date:"2026-11-15",
  }};
  it("requires exact positive quantity, operation identity and trusted scope",()=>{
    expect(InventoryConversionExecuteRequestSchema.safeParse(conversion).success).toBe(true);
    expect(IpcRequestSchema.safeParse(conversion).success).toBe(true);
    expect(IpcRequestSchema.safeParse({...conversion,operation_id:undefined}).success).toBe(false);
    expect(IpcRequestSchema.safeParse({...conversion,payload:{...conversion.payload,quantity:"0.000000"}}).success).toBe(false);
    expect(IpcRequestSchema.safeParse({...conversion,payload:{...conversion.payload,quantity:"2.0000001"}}).success).toBe(false);
    expect(IpcRequestSchema.safeParse({...conversion,branch_id:ids.target}).success).toBe(false);
  });
});
