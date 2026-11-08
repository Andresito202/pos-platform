import type { MerchantDestinationExpectedScope, MerchantDestinationSnapshotVerifier } from "../security/merchant-destination-snapshot-verifier.js";
import type { SqliteMerchantDestinationProjectionStore } from "./sqlite-merchant-destination-projection-store.js";

/**
 * QR-001. Central's acknowledged sequence MUST be queried for the exact
 * installation and company, from an authenticated backend with durable state.
 * null is "no prior acknowledgement", NOT a transport error.
 * A network/authentication error MUST reject; never substitute a local value.
 */
export interface MerchantDestinationAcknowledgedFloor {
  floorFor(input: {
    readonly installationId: string;
    readonly tenantId: string;
    readonly companyId: string;
  }): Promise<number | null>;
}
export interface MerchantDestinationInstallationScope extends MerchantDestinationExpectedScope {
  readonly installationId: string;
}
export type MerchantDestinationActivationOutcome =
  | { readonly kind: "ACTIVATED"; readonly sequence: number }
  | { readonly kind: "REJECTED"; readonly reason: string };

/**
 * The only orchestration boundary: remote acknowledged floor -> signature ->
 * local compare-and-swap. This is NOT exposed through renderer IPC.
 *
 * Remaining gap: the source of the floor and the snapshot issuer must be
 * provisioned by Central. Their connection is intentionally absent.
 */
export class MerchantDestinationActivationService {
  constructor(
    private readonly verifier: MerchantDestinationSnapshotVerifier,
    private readonly store: SqliteMerchantDestinationProjectionStore,
    private readonly floor: MerchantDestinationAcknowledgedFloor,
  ) {}

  async acceptSigned(input: unknown, scope: MerchantDestinationInstallationScope): Promise<MerchantDestinationActivationOutcome> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.installationId)) {
      return {kind:"REJECTED",reason:"INVALID_INSTALLATION"};
    }
    let centralFloor: number | null;
    try {
      centralFloor=await this.floor.floorFor({
        installationId:scope.installationId, tenantId:scope.tenantId, companyId:scope.companyId,
      });
    } catch {
      return {kind:"REJECTED",reason:"CENTRAL_FLOOR_UNAVAILABLE"};
    }
    if (centralFloor !== null && (!Number.isSafeInteger(centralFloor) || centralFloor < 1)) {
      return {kind:"REJECTED",reason:"INVALID_CENTRAL_FLOOR"};
    }
    // Missing/corrupt local state is never silently trusted as a fresh install.
    let localSequence: number | null;
    try { localSequence=this.store.load(scope)?.snapshot.sequence ?? null; }
    catch { return {kind:"REJECTED",reason:"LOCAL_SNAPSHOT_CORRUPTED"}; }

    const verification=this.verifier.verify(input,scope);
    if(verification.decision!=="VALID") return {kind:"REJECTED",reason:verification.decision};
    const effectiveFloor=Math.max(centralFloor??0,localSequence??0);
    if(verification.snapshot.sequence<=effectiveFloor) {
      return {kind:"REJECTED",reason:"OBSOLETE_OR_REPLAYED_SEQUENCE"};
    }
    try {
      const activated=this.store.activatePreverified(scope,verification.snapshot,verification.evaluatedAt);
      return {kind:"ACTIVATED",sequence:activated.snapshot.sequence};
    } catch (error) {
      return {kind:"REJECTED",reason:error instanceof Error?error.message:"ACTIVATION_FAILURE"};
    }
  }
}
