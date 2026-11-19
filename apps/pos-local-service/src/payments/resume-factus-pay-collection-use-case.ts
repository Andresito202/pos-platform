import { CanonicalPermission } from "@pos-platform/contracts";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqlitePaymentStore } from "./sqlite-payment-store.js";
import { FactusPayClient, FactusPayClientError } from "./factus-pay-client.js";

export const PERMISSION_FACTUS_PAY_RESUME = CanonicalPermission.PAYMENTS_PAYMENT_READ;
const PROVIDER_CODE = "FACTUS_PAY";

export interface ResumeFactusPayCollectionRequest {
  readonly saleId: string;
}

export type ResumeFactusPayCollectionResult =
  | {
      readonly kind: "FOUND";
      readonly paymentId: string;
      readonly version: number;
      readonly status: string;
      readonly expectedAmount: string;
      readonly referenceCode: string;
      readonly qr: string | null;
      readonly providerStatus: string | null;
    }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "FACTUS_PAY_NOT_CONFIGURED" }
  | { readonly kind: "FACTUS_PAY_VERIFICATION_FAILED" };

/**
 * Recovers a pending FACTUS Pay collection after renderer/service restart.
 * Re-reads the durable CREATED QR payment and optionally refreshes QR via GET.
 * Never confirms the sale.
 */
export class ResumeFactusPayCollectionUseCase {
  constructor(
    private readonly paymentStore: SqlitePaymentStore,
    private readonly factusPay: FactusPayClient | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ResumeFactusPayCollectionRequest,
  ): Promise<ResumeFactusPayCollectionResult> {
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_FACTUS_PAY_RESUME,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at: this.now(),
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const pending = this.paymentStore.findPendingFactusPayBySale(scope, request.saleId, PROVIDER_CODE);
    if (pending === null) return { kind: "NOT_FOUND" };

    let qr: string | null = null;
    let providerStatus: string | null = null;
    if (this.factusPay !== null && pending.providerReference !== null) {
      try {
        const detail = await this.factusPay.getCollection({
          referenceCode: pending.providerReference,
          expectedAmountScale6: pending.expectedAmount,
        });
        qr = detail.qr;
        providerStatus = detail.status;
      } catch (error) {
        if (error instanceof FactusPayClientError && error.code === "FACTUS_PAY_NOT_CONFIGURED") {
          return { kind: "FACTUS_PAY_NOT_CONFIGURED" };
        }
        // Durable payment still resumes without a live QR image.
      }
    } else if (this.factusPay === null) {
      return {
        kind: "FOUND",
        paymentId: pending.paymentId,
        version: pending.version,
        status: pending.status,
        expectedAmount: pending.expectedAmount,
        referenceCode: pending.providerReference ?? "",
        qr: null,
        providerStatus: null,
      };
    }

    return {
      kind: "FOUND",
      paymentId: pending.paymentId,
      version: pending.version,
      status: pending.status,
      expectedAmount: pending.expectedAmount,
      referenceCode: pending.providerReference ?? "",
      qr,
      providerStatus,
    };
  }
}
