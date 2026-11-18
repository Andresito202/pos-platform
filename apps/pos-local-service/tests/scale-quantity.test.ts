import { describe, expect, it } from "vitest";
import { scaleQuantity } from "../src/hardware/scale-quantity.js";
describe("scale quantity from catalog unit",()=>{
  it("preserves exact physical quantities",()=>{
    expect(scaleQuantity(265,"KGM",3)).toBe("0.265000");
    expect(scaleQuantity(265,"GRM",0)).toBe("265.000000");
    expect(scaleQuantity(250,"KGM",2)).toBe("0.250000");
  });
  it("does not round or convert non-mass units",()=>{
    expect(scaleQuantity(265,"KGM",2)).toBeNull();
    expect(scaleQuantity(265,"UND",3)).toBeNull();
    expect(scaleQuantity(266,"KGM",3)).toBeNull();
    expect(scaleQuantity(0,"KGM",3)).toBeNull();
  });
});
