import { MerchantDestinationDraftSchema, MerchantDestinationRevisionSchema, type MerchantDestinationDraft, type MerchantDestinationRevision } from "./merchant-destination.js";
import { publishDestination, revokeDestination, type MerchantDestinationAccess } from "./merchant-destination-policy.js";

/**
 * QR-001 application boundary. Caller must resolve MerchantDestinationAccess
 * from the authenticated backend session, never from a request body.
 *
 * The transaction adapter must provide a SERIALIZABLE/CAS boundary, enforce
 * (tenant_id,company_id,id) uniqueness and atomically persist BOTH the new
 * revision and its audit/outbox event before acknowledging success.
 *
 * No built-in memory persistence, network adapter, or privilege escalation.
 * This module does not wire an endpoint or enable cashier UI.
 */
export type DestinationEventType = "DESTINATION_DRAFT_CREATED" | "DESTINATION_PUBLISHED" | "DESTINATION_REVOKED";
export interface DestinationMutationEvent {
  readonly type: DestinationEventType;
  readonly tenant_id: string;
  readonly company_id: string;
  readonly destination_id: string;
  readonly actor_user_id: string;
  readonly destination_version: number;
  readonly at: string;
}
export interface DestinationMutationTransaction {
  /** Lookup is scoped server-side: a foreign id MUST return null. */
  getDestination(tenantId: string, companyId: string, id: string): Promise<MerchantDestinationRevision | null>;
  /**
   * MUST use INSERT with UNIQUE constraints for a new id and immutable history.
   * A published destination cannot be replaced without explicit revocation.
   */
  createDraft(record: MerchantDestinationRevision): Promise<void>;
  /**
   * Compare-and-swap expectedVersion in the same database transaction.
   * Returns false when another writer has already updated the destination.
   */
  replaceIfVersion(record: MerchantDestinationRevision, expectedVersion: number): Promise<boolean>;
  appendAuditAndOutbox(event: DestinationMutationEvent): Promise<void>;
}
export interface DestinationMutationStore {
  /** Must roll back all writes and the outbox event when callback rejects. */
  transaction<T>(fn: (tx: DestinationMutationTransaction) => Promise<T>): Promise<T>;
}

function assertAdmin(access: MerchantDestinationAccess): void {
  if (!access.canConfigure) throw new Error("FORBIDDEN");
}
function validateIdentifiers(access: MerchantDestinationAccess, id: string): void {
  if (!access.tenantId || !access.companyId || !access.userId || !id) throw new Error("INVALID_SCOPE");
}
function validateTime(at: string): void {
  if (!Number.isFinite(Date.parse(at)) || !/^\d{4}-\d{2}-\d{2}T/.test(at)) throw new Error("INVALID_TIMESTAMP");
}
function event(type: DestinationEventType, access: MerchantDestinationAccess, record: MerchantDestinationRevision, at: string): DestinationMutationEvent {
  return { type, tenant_id: access.tenantId, company_id: access.companyId, destination_id: record.id, actor_user_id: access.userId, destination_version: record.version, at };
}
export class MerchantDestinationCommands {
  constructor(private readonly store: DestinationMutationStore) {}

  async createDraft(access: MerchantDestinationAccess, id: string, input: MerchantDestinationDraft, at: string): Promise<MerchantDestinationRevision> {
    assertAdmin(access);
    validateIdentifiers(access, id);
    validateTime(at);
    const draft=MerchantDestinationDraftSchema.parse(input);
    const record=MerchantDestinationRevisionSchema.parse({
      id, tenant_id: access.tenantId, company_id: access.companyId,
      version: 1, status: "DRAFT", ...draft,
      created_by_user_id: access.userId, published_at: null, revoked_at: null,
    });
    return this.store.transaction(async tx => {
      if (await tx.getDestination(access.tenantId, access.companyId, id) !== null) throw new Error("ALREADY_EXISTS");
      await tx.createDraft(record);
      await tx.appendAuditAndOutbox(event("DESTINATION_DRAFT_CREATED",access,record,at));
      return record;
    });
  }

  async publish(access: MerchantDestinationAccess, id: string, expectedVersion: number, at: string): Promise<MerchantDestinationRevision> {
    return this.transition(access,id,expectedVersion,at,"PUBLISH");
  }

  async revoke(access: MerchantDestinationAccess, id: string, expectedVersion: number, at: string): Promise<MerchantDestinationRevision> {
    return this.transition(access,id,expectedVersion,at,"REVOKE");
  }

  private async transition(access: MerchantDestinationAccess,id: string, expectedVersion: number,at: string,kind:"PUBLISH"|"REVOKE"): Promise<MerchantDestinationRevision> {
    assertAdmin(access);
    validateIdentifiers(access,id);
    validateTime(at);
    return this.store.transaction(async tx => {
      const prior=await tx.getDestination(access.tenantId,access.companyId,id);
      if(prior === null) throw new Error("NOT_FOUND");
      const next=kind==="PUBLISH" ? publishDestination(prior,access,expectedVersion,at) : revokeDestination(prior,access,expectedVersion,at);
      const written=await tx.replaceIfVersion(next,prior.version);
      if(!written) throw new Error("VERSION_CONFLICT");
      await tx.appendAuditAndOutbox(event(kind==="PUBLISH"?"DESTINATION_PUBLISHED":"DESTINATION_REVOKED",access,next,at));
      return next;
    });
  }
}
