import {
  PostgresBusinessSessionCreationTransaction,
  PostgresBrowserSessionHandoffWriter,
  type BusinessSessionValidationPolicy, type PersistedBusinessSession, type createPostgresPool,
} from "@pos-platform/database-postgres";
import { BusinessInitialMfaFlow } from "./business-initial-mfa-flow.js";

/** Internal persistence only. No login transport, bearer token, refresh or SSA. */
export class BusinessSessionAuthority {
  private readonly transaction;
  constructor(
    pool: ReturnType<typeof createPostgresPool>,
    private readonly mfaFlow: BusinessInitialMfaFlow,
    trustedPolicy: BusinessSessionValidationPolicy,
  ) {
    if (!(mfaFlow instanceof BusinessInitialMfaFlow)) throw new Error("BUSINESS_SESSION_TRUSTED_MFA_FLOW_REQUIRED");
    this.transaction = new PostgresBusinessSessionCreationTransaction(pool, trustedPolicy);
  }

  async create(input: {
    readonly mfaReceipt: unknown;
    readonly selection: { readonly tenantId: string; readonly membershipId: string };
  },completion?:Parameters<PostgresBusinessSessionCreationTransaction["create"]>[2]): Promise<PersistedBusinessSession | null> {
    // Synchronous one-use redemption BEFORE the first await: concurrent callers
    // cannot share a receipt. Even a later rollback requires fresh authentication.
    const evidence = this.mfaFlow.takeForBusinessSession(input.mfaReceipt);
    if (!evidence) return null;
    return this.transaction.create(evidence, input.selection,completion);
  }

  /** Privileged server composition: MFA-originated transaction creates a
   * PostgreSQL one-use handoff. UUIDs/JSON cannot substitute the MFA receipt. */
  async createBrowserHandoff(input:Parameters<BusinessSessionAuthority["create"]>[0],writer:PostgresBrowserSessionHandoffWriter):Promise<string|null>{
    if(!(writer instanceof PostgresBrowserSessionHandoffWriter))throw Error("BROWSER_HANDOFF_TRUSTED_WRITER_REQUIRED");
    const session=await this.create(input,writer.write);
    return session?writer.take(session):null;
  }
}
