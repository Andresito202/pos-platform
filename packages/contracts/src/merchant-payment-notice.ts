import * as z from "zod";

export const MERCHANT_PAYMENT_NOTICE_PATH = "/v1/commercial/merchant-notifications/ingest";

export const MerchantPaymentNoticeObservationSchema = z.strictObject({
  source: z.literal("NEQUI_NEGOCIOS_SHARED_SMS"),
  message_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  observed_at: z.iso.datetime({ offset: true }),
  reported_amount_cop: z.number().int().min(1).max(100_000_000).nullable(),
});

export type MerchantPaymentNoticeObservation = z.infer<typeof MerchantPaymentNoticeObservationSchema>;
