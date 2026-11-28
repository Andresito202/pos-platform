import * as z from "zod";
import { UuidSchema } from "./primitives.js";

/** Shared-service auth between Central Authority and camacho-pos-comercial. */
export const COMMERCIAL_BRIDGE_KEY_HEADER = "x-central-commercial-bridge-key" as const;
export const COMMERCIAL_TRIAL_WEBHOOK_KEY_HEADER = "x-central-trial-webhook-key" as const;

const BLOCKED_CALLBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata",
]);

const PRIVATE_OR_LINK_LOCAL_V4 =
  /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/**
 * SSRF guard for commercialApiOrigin used as Central→CRM callback base.
 * Rejects loopback, link-local, cloud metadata, credentials-in-URL, and non-HTTPS
 * except the unit-test fixture host `commercial.test`.
 * Returns a normalized origin (no trailing slash / path).
 */
export function assertSafeCommercialPortalCallbackOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("COMMERCIAL_CALLBACK_ORIGIN_INVALID");
  }
  if (url.username || url.password) {
    throw new Error("COMMERCIAL_CALLBACK_ORIGIN_CREDENTIALS_FORBIDDEN");
  }
  if (url.search || url.hash) {
    throw new Error("COMMERCIAL_CALLBACK_ORIGIN_QUERY_FORBIDDEN");
  }
  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_CALLBACK_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.includes(":") ||
    PRIVATE_OR_LINK_LOCAL_V4.test(host)
  ) {
    throw new Error("COMMERCIAL_CALLBACK_ORIGIN_SSRF_BLOCKED");
  }
  const isTestFixture = host === "commercial.test";
  if (isTestFixture) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("COMMERCIAL_CALLBACK_ORIGIN_PROTOCOL");
    }
  } else if (url.protocol !== "https:") {
    throw new Error("COMMERCIAL_CALLBACK_ORIGIN_HTTPS_REQUIRED");
  }
  return url.origin;
}

const CommercialApiOriginSchema = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    try {
      assertSafeCommercialPortalCallbackOrigin(value);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : "COMMERCIAL_CALLBACK_ORIGIN_INVALID",
      });
    }
  })
  .transform((value) => assertSafeCommercialPortalCallbackOrigin(value));

export const CommercialPortalIntrospectRequestSchema = z.strictObject({
  audience: z.literal("commercial-portal"),
});

export const CommercialPortalIntrospectResponseSchema = z.strictObject({
  active: z.boolean(),
  role: z.enum(["SUPERADMIN_GLOBAL", "BUSINESS_ADMIN"]).optional(),
  subjectId: z.string().min(1).max(128).optional(),
  tenantId: z.string().min(1).max(128).optional(),
  authority: z.enum(["GLOBAL", "BUSINESS"]).optional(),
  expiresAt: z.string().datetime().optional(),
});

/** Mint body — subject identity comes from verified GLOBAL MFA session, not this payload. */
export const CommercialPortalMintRequestSchema = z.strictObject({
  role: z.literal("SUPERADMIN_GLOBAL"),
  ttlSeconds: z.number().int().min(60).max(86_400).optional(),
  jti: z.string().min(8).max(128),
});

export const CommercialPortalMintResponseSchema = z.strictObject({
  accessToken: z.string().min(32),
  tokenType: z.literal("Bearer"),
  expiresAt: z.string().datetime(),
  role: z.literal("SUPERADMIN_GLOBAL"),
  subjectId: z.string(),
  tenantId: z.literal("global"),
  authority: z.literal("GLOBAL"),
});

export const CommercialTrialIssueRequestSchema = z.strictObject({
  trialId: z.string().min(8).max(128),
  email: z.string().email(),
  companyName: z.string().min(1).max(200).optional(),
  trialHours: z.literal(120),
  commercialApiOrigin: CommercialApiOriginSchema,
  jti: z.string().min(8).max(128),
  /** When present with planId, Central writes licensing.licenses TRIAL row. */
  tenantId: UuidSchema.optional(),
  planId: UuidSchema.optional(),
});

export const CommercialTrialIssueResponseSchema = z.strictObject({
  centralLicenseRef: z.string().min(8),
  contractStatus: z.literal("TRIAL"),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  trialHours: z.literal(120),
  commercialActivation: z.enum(["ACTIVATED", "ALREADY_ACTIVE", "CALLBACK_FAILED"]),
  idempotent: z.boolean(),
});

export const CommercialPaidOrderBindingSchema = z.strictObject({
  companyId: UuidSchema,
  paymentReference: z.string().min(1).max(128),
  paidAt: z.string().datetime(),
  billingInterval: z.enum(["PERPETUAL", "MONTHLY", "ANNUAL"]),
});

export const CommercialProvisioningRequestSchema = z.strictObject({
  orderId: z.string().min(1).max(128),
  orderNumber: z.string().min(1).max(128),
  customerEmail: z.string().email(),
  businessProfileId: z.string().min(1).max(128).nullable().optional(),
  licenseUnits: z.number().int().positive().max(10_000),
  cajaRule: z.literal("ONE_LICENSE_ONE_CAJA"),
  tenantId: UuidSchema.optional(),
  planId: UuidSchema.optional(),
  paidOrder: CommercialPaidOrderBindingSchema.optional(),
  items: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(200),
        quantity: z.number().int().positive(),
        planId: z.string().nullable().optional(),
        kitId: z.string().nullable().optional(),
        priceVersion: z.number().int().nullable().optional(),
        unitAmountCents: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const CommercialOrderActivationStatusRequestSchema = z.strictObject({
  orderId: z.string().min(1).max(128),
  provisioningId: z.string().min(8).max(128),
});

export const CommercialOrderActivationStatusResponseSchema =
  CommercialOrderActivationStatusRequestSchema.extend({
    receipts: z.array(z.strictObject({
      licenseId: UuidSchema,
      activationId: UuidSchema,
      receiptId: UuidSchema,
    })).max(10_000),
  });

export const CommercialProvisioningResponseSchema = z.strictObject({
  status: z.enum(["ACCEPTED", "DUPLICATE"]),
  provisioningId: z.string().min(8),
  idempotencyKey: z.string().min(8),
  licenseUnits: z.number().int().positive(),
  cajaRule: z.literal("ONE_LICENSE_ONE_CAJA"),
  /** QUEUED until tenant/plan bound; ISSUED when licensing.licenses rows exist. */
  fulfillment: z.enum(["QUEUED", "ISSUED", "ALREADY_QUEUED", "ALREADY_ISSUED"]),
  licenseIds: z.array(UuidSchema).max(10_000),
});

export const CommercialTrialExpireSweepResponseSchema = z.strictObject({
  revoked: z.number().int().nonnegative(),
  commercialNotified: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
});
