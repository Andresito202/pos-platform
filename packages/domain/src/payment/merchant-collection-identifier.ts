import { PaymentDomainError } from "./payment-domain-errors.js";

/**
 * B28-PAYNOTIF: what the merchant displays to receive a payment (a static
 * QR, or a "llave" — Colombia's interoperable-transfer alias, phone/
 * document/email-style account key). Deliberately NOT proof of payment
 * (FASE 3: "NO usarlo como prueba de pago") — it only identifies the
 * collection destination; `PaymentAttempt.confirm()` is the only thing
 * that can move a payment toward CONFIRMED, and never reads this value to
 * do so.
 *
 * `payments-schema.md`'s real `payment_attempts.intent_reference` column
 * (NULL, single string) is the closest existing physical hook for this
 * concept, but it doesn't distinguish QR from Llave — this value object is
 * this block's own conceptual addition, not a claim that catalog-schema.md-
 * style physical column design already exists for it. Reconciling
 * `{type, value}` here against a single `intent_reference` string (or a
 * future two-column split) is left to a future physical-model block.
 */
export type MerchantCollectionIdentifierType = "QR_STATIC" | "KEY";

export class MerchantCollectionIdentifier {
  private constructor(readonly type: MerchantCollectionIdentifierType, readonly value: string) {}

  static of(type: MerchantCollectionIdentifierType, value: string): MerchantCollectionIdentifier {
    if (!value.trim()) {
      throw new PaymentDomainError("EMPTY_COLLECTION_IDENTIFIER_VALUE", "collection identifier value must not be empty");
    }
    return new MerchantCollectionIdentifier(type, value);
  }

  equals(other: MerchantCollectionIdentifier): boolean {
    return this.type === other.type && this.value === other.value;
  }
}
