import * as z from "zod";
import { ContractVersionSchema, type ContractVersion } from "./primitives.js";

function numericVersion(version: ContractVersion): readonly [number, number, number] {
  const parsed = ContractVersionSchema.parse(version);
  const parts = parsed.split(".").map((part) => Number(part));
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function compareContractVersions(left: ContractVersion, right: ContractVersion): number {
  const leftParts = numericVersion(left);
  const rightParts = numericVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = leftParts[index]! - rightParts[index]!;
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export const ContractVersionRangeSchema = z.strictObject({
  min: ContractVersionSchema,
  max: ContractVersionSchema,
}).superRefine((range, context) => {
  if (compareContractVersions(range.min, range.max) > 0) {
    context.addIssue({
      code: "custom",
      path: ["max"],
      message: "max contract version must be greater than or equal to min",
    });
  }
});

export type ContractVersionRange = z.infer<typeof ContractVersionRangeSchema>;

export function isContractVersionCompatible(version: ContractVersion, range: ContractVersionRange): boolean {
  const validatedRange = ContractVersionRangeSchema.parse(range);
  return compareContractVersions(version, validatedRange.min) >= 0
    && compareContractVersions(version, validatedRange.max) <= 0;
}
