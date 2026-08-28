import * as z from "zod";
import { ExpectedVersionSchema, MessageKeySchema, StableCodeSchema, UuidSchema } from "./primitives.js";

export const ErrorCategorySchema = z.enum([
  "VALIDATION",
  "AUTHENTICATION",
  "AUTHORIZATION",
  "CONFLICT",
  "NOT_FOUND",
  "DEPENDENCY_UNAVAILABLE",
  "RATE_LIMITED",
  "INCOMPATIBLE_VERSION",
  "INTEGRITY",
  "UNKNOWN_OUTCOME",
  "INTERNAL",
]);

export const FieldErrorSchema = z.strictObject({
  path: z.array(z.union([z.string().min(1).max(80), z.number().int().nonnegative()])).min(1).max(16),
  code: StableCodeSchema,
  user_message_key: MessageKeySchema,
});

export const ContractErrorSchema = z.strictObject({
  code: StableCodeSchema,
  category: ErrorCategorySchema,
  retryable: z.boolean(),
  user_message_key: MessageKeySchema,
  field_errors: z.array(FieldErrorSchema).max(100),
  current_version: ExpectedVersionSchema.nullable(),
  required_action: StableCodeSchema.nullable(),
  diagnostic_id: UuidSchema,
  retry_after_ms: z.number().int().nonnegative().max(86_400_000).optional(),
}).superRefine((error, context) => {
  if (error.retry_after_ms !== undefined && error.category !== "RATE_LIMITED") {
    context.addIssue({
      code: "custom",
      path: ["retry_after_ms"],
      message: "retry_after_ms is only valid for RATE_LIMITED errors",
    });
  }
});

export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;
export type ContractError = z.infer<typeof ContractErrorSchema>;
