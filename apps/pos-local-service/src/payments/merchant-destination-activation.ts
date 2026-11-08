import type { MerchantDestinationExpectedScope, MerchantDestinationSnapshotVerifier } from "../security/merchant-destination-snapshot-verifier.js";
import type { SqliteMerchantDestinationProjectionStore } from "./sqlite-merchant-destination-projection-store.js";

/**
 * QR-001 verified activation boundary.
 * Signature verification and persistence are deliberately composed here.
 * This class is NOT exposed through renderer IPC or an HTTP handler.
 *
 * Replay protection currently uses the local durable sequence only.
 * A central acknowledged-floor check, required to detect restoration to an
 * older backup, must be attached before enabling online distribution.
 */
export type MerchantDestinationActivationOutcome =
  | {readonly kind:"ACTIVATED";readonly sequence:number}
  | {readonly kind:"REJECTED";readonly reason:string};

export class MerchantDestinationActivationService {
  constructor(
    private readonly verifier: MerchantDestinationSnapshotVerifier,
    private readonly store: SqliteMerchantDestinationProjectionStore,
  ) {}

  acceptSigned(input: unknown, scope: MerchantDestinationExpectedScope): MerchantDestinationActivationOutcome {
    const verified=this.verifier.verify(input,scope);
    if(verified.decision!=="VALID") return {kind:"REJECTED",reason:verified.decision};
    try{
      const activated=this.store.activatePreverified(scope,verified.snapshot,verified.evaluatedAt);
      return {kind:"ACTIVATED",sequence:activated.snapshot.sequence};
    }catch(error){
      return {kind:"REJECTED",reason:error instanceof Error?error.message:"ACTIVATION_FAILURE"};
    }
  }
}
