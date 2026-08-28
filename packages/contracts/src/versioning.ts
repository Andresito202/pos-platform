import * as z from "zod";
import { ContractVersionSchema, type ContractVersion } from "./primitives.js";

function numericVersion(version: ContractVersion): readonly [bigint, bigint, bigint] {
  const parsed = ContractVersionSchema.parse(version);
  const parts = parsed.split(".").map((part) => BigInt(part));
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function compareContractVersions(left: ContractVersion, right: ContractVersion): number {
  const leftParts = numericVersion(left);
  const rightParts = numericVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index]!;
    const rightPart = rightParts[index]!;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
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
