import * as z from "zod";

/**
 * QR-001. Solo configuración de destino de transferencia (Nequi / Bre-B);
 * NO es API bancaria ni fuente de confirmación financiera.
 *
 * El identificador tenant/company lo asigna el servicio de confianza a partir
 * de la sesión: jamás se acepta un scope enviado desde la pantalla.
 */
const Uuid = z.string().uuid();
const DestinationKind = z.enum(["NEQUI_NUMBER", "BREB_KEY", "NEQUI_BUSINESS_QR"]);
const Checksum = z.string().regex(/^[a-f0-9]{64}$/);

export const MerchantDestinationDraftSchema = z.strictObject({
  kind: DestinationKind,
  label: z.string().trim().min(1).max(80),
  destination_reference: z.string().trim().min(4).max(160),
  qr_asset_id: Uuid.nullable(),
  qr_sha256: Checksum.nullable(),
}).superRefine((draft, ctx) => {
  if ((draft.qr_asset_id === null) !== (draft.qr_sha256 === null)) {
    ctx.addIssue({code: "custom", message: "QR asset and digest must be present together"});
  }
  if (draft.kind === "NEQUI_BUSINESS_QR" && draft.qr_asset_id === null) {
    ctx.addIssue({code: "custom", message: "Official QR asset required"});
  }
  if (draft.kind === "NEQUI_NUMBER" && !/^3[0-9]{9}$/.test(draft.destination_reference)) {
    ctx.addIssue({code: "custom", message: "Invalid Colombian Nequi number"});
  }
});

export type MerchantDestinationDraft = z.infer<typeof MerchantDestinationDraftSchema>;

export const MerchantDestinationRevisionSchema = z.strictObject({
  id: Uuid,
  tenant_id: Uuid,
  company_id: Uuid,
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "PUBLISHED", "REVOKED"]),
  kind: DestinationKind,
  label: z.string().min(1).max(80),
  destination_reference: z.string().min(4).max(160),
  qr_asset_id: Uuid.nullable(),
  qr_sha256: Checksum.nullable(),
  created_by_user_id: Uuid,
  published_at: z.string().datetime({offset: true}).nullable(),
  revoked_at: z.string().datetime({offset: true}).nullable(),
});
export type MerchantDestinationRevision = z.infer<typeof MerchantDestinationRevisionSchema>;

/** Read-only projection for any cash register belonging to this company. */
export const CashierDestinationSchema = MerchantDestinationRevisionSchema.pick({
  kind: true, label: true, destination_reference: true,
  qr_asset_id: true, qr_sha256: true, version: true,
});
export type CashierDestination = z.infer<typeof CashierDestinationSchema>;
