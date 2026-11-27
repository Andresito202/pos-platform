import {describe,expect,it} from "vitest";
import {AndroidCommercialProvisionSchema,ANDROID_COMMERCIAL_MIGRATION_IDS} from "../src/index.js";
describe("Android Central provision boundary",()=>{
 it("rejects incomplete provision and unknown fields",()=>{
   expect(AndroidCommercialProvisionSchema.safeParse({profile:"CAMACHO_ANDROID_CENTRAL_V1"}).success).toBe(false);
   expect(AndroidCommercialProvisionSchema.safeParse({profile:"CAMACHO_ANDROID_CENTRAL_V1",unexpected:true}).success).toBe(false);
   expect(new Set(ANDROID_COMMERCIAL_MIGRATION_IDS).size).toBe(ANDROID_COMMERCIAL_MIGRATION_IDS.length);
 });
});
