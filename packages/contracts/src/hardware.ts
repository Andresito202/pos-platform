import * as z from "zod";
import { UuidSchema } from "./primitives.js";
import { createRequestEnvelopeSchema,createResponseEnvelopeSchema } from "./envelope.js";

export const HardwareCapabilitySchema=z.enum(["UNKNOWN","SUPPORTED","UNSUPPORTED"]);
export const HardwareProfileSchema=z.strictObject({
  schema_version:z.literal("1.0.0"),id:z.string().min(1).max(80),revision:z.number().int().positive(),
  manufacturer:z.string().min(1),model:z.string().min(1),firmware:z.string().min(1),
  support_status:z.enum(["UNTESTED","SIMULATED","LAB_VALIDATED","PILOT_VALIDATED","CERTIFIED","CONDITIONAL","DEPRECATED","UNSUPPORTED"]),
  evidence:z.string().min(1),protocol:z.enum(["ESC_POS","VENDOR_SDK"]),
  transport:z.enum(["USB","BLUETOOTH_SPP","BLE_GATT","TCP","SERIAL","WINDOWS_SPOOLER","CUPS","ANDROID_SDK","SIMULATOR"]),
  paper_mm:z.union([z.literal(58),z.literal(80)]),columns:z.number().int().min(16).max(80),
  encoding:z.literal("CP1252"),code_page:z.number().int().min(0).max(255),
  cut:HardwareCapabilitySchema,drawer:HardwareCapabilitySchema,drawer_sensor:HardwareCapabilitySchema,
  cut_command:z.enum(["GS_V_0","GS_V_1"]).nullable().default(null),
  paper_sensor:HardwareCapabilitySchema,
  // Trusted, model-specific values from its manual; NO electrical defaults.
  drawer_pulse:z.strictObject({pin:z.union([z.literal(0),z.literal(1)]),on:z.number().int().min(1).max(255),off:z.number().int().min(1).max(255)}).nullable(),
}).superRefine((value,ctx)=>{
  if ((value.drawer==="SUPPORTED")!==(value.drawer_pulse!==null)) ctx.addIssue({code:"custom",message:"documented drawer profile required"});
  if ((value.cut==="SUPPORTED")!==(value.cut_command!==null)) ctx.addIssue({code:"custom",message:"documented cutter command required"});
});
export type HardwareProfile=z.infer<typeof HardwareProfileSchema>;
export const HardwareJobStateSchema=z.enum(["PENDING","DISPATCHING","TRANSPORT_ACCEPTED","FAILED","UNKNOWN"]);
export type HardwareJobState=z.infer<typeof HardwareJobStateSchema>;
export const HardwareCommandSchema=z.discriminatedUnion("action",[
  z.strictObject({action:z.literal("diagnose")}),
  z.strictObject({action:z.literal("list")}),
  z.strictObject({action:z.literal("associate"),binding_id:UuidSchema,cash_register_id:UuidSchema,device_id:z.string().min(1).max(160),profile_id:z.string().min(1).max(80)}),
  z.strictObject({action:z.literal("enqueue"),job_id:UuidSchema,binding_id:UuidSchema,kind:z.enum(["PRINT_TEST","PRINT_RECEIPT","DRAWER_OPEN","CUT"]),sale_id:UuidSchema.nullable(),reason:z.string().trim().min(3).max(200)}),
  z.strictObject({action:z.literal("dispatch"),job_id:UuidSchema}),
]);
export type HardwareCommand=z.infer<typeof HardwareCommandSchema>;
export const HardwareRequestSchema=createRequestEnvelopeSchema(HardwareCommandSchema)
  .safeExtend({message_type:z.literal("hardware.command")}).superRefine((request,ctx)=>{
    for(const key of ["actor_type","actor_id","tenant_id","company_id","branch_id","session_id","device_id"] as const) {
      if (key in request && request[key as keyof typeof request]!=null) ctx.addIssue({code:"custom",path:[key],message:"hardware identity comes from trusted context"});
    }
  });
// Versioned open result records contain adapter diagnostics, never raw commands.
export const HardwareResponseSchema=createResponseEnvelopeSchema(z.strictObject({
  kind:z.string(),data:z.json().nullable(),reason:z.string().nullable(),
}));
