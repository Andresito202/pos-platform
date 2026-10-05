import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  OnboardingActor,
  OnboardingRecord,
  OnboardingRepository,
  OnboardingResult,
  OnboardingTransaction,
} from "@pos-platform/application";

export type PostgresOnboardingRepositoryOptions = { pool: Pool };

function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function normalizeOptional(value: string | undefined): string | null { const normalized = value?.trim(); return normalized ? normalized : null; }
function checksum(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function actorType(actor: OnboardingActor): string { return actor.type; }

function mapOnboarding(row: any): OnboardingRecord {
  return {
    onboardingId: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    branchId: row.branch_id,
    ownerUserId: row.owner_user_id,
    tenantMembershipId: row.tenant_membership_id,
    status: row.status,
    reasonCode: row.reason_code,
    licenseReference: row.license_reference,
    requestedPlan: row.requested_plan,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    requestChecksum: row.request_checksum,
    actor: { type: row.actor_type, id: row.actor_id },
  };
}

class PostgresOnboardingTransaction implements OnboardingTransaction {
  constructor(private readonly client: PoolClient) {}

  async setActorContext(actor: OnboardingActor): Promise<void> {
    await this.client.query("SELECT set_config('app.actor_id',$1,true)", [actor.id]);
  }

  async setTenantContext(tenantId: string): Promise<void> {
    await this.client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  }

  async findOnboarding(actor: OnboardingActor, idempotencyKey: string): Promise<OnboardingRecord | null> {
    const result = await this.client.query(
      `SELECT id::text, actor_type, actor_id::text, idempotency_key, request_checksum, correlation_id::text,
              tenant_id::text, company_id::text, branch_id::text, owner_user_id::text,
              tenant_membership_id::text, status, reason_code, license_reference, requested_plan,
              created_at, updated_at
         FROM tenancy.onboarding_operations
        WHERE actor_type=$1 AND actor_id=$2 AND idempotency_key=$3
        FOR UPDATE`,
      [actor.type, actor.id, idempotencyKey],
    );
    return result.rows[0] ? mapOnboarding(result.rows[0]) : null;
  }

  async assertCommercialReferenceAvailable(reference: string | undefined): Promise<void> {
    const value = normalizeOptional(reference);
    if (!value) return;
    const result = await this.client.query(
      "SELECT 1 FROM tenancy.onboarding_operations WHERE commercial_reference=$1 AND status NOT IN ('FAILED','CANCELLED') LIMIT 1",
      [value],
    );
    if (result.rowCount) throw new Error("ONBOARDING_COMMERCIAL_REFERENCE_CONFLICT");
  }

  async resolveOrCreateOwner(input: { userId?: string; email: string; phone?: string; fullName: string }): Promise<{ userId: string; created: boolean }> {
    if (input.userId) {
      const existing = await this.client.query(
        "SELECT id::text,email,email_normalized FROM identity.users WHERE id=$1 FOR UPDATE",
        [input.userId],
      );
      if (!existing.rows[0]) throw new Error("ONBOARDING_OWNER_USER_NOT_FOUND");
      if (existing.rows[0].email_normalized !== normalizeEmail(input.email)) throw new Error("ONBOARDING_OWNER_IDENTITY_MISMATCH");
      return { userId: existing.rows[0].id, created: false };
    }

    const email = input.email.trim();
    const emailNormalized = normalizeEmail(email);
    const existing = await this.client.query(
      "SELECT id::text FROM identity.users WHERE email_normalized=$1 FOR UPDATE",
      [emailNormalized],
    );
    if (existing.rows[0]) return { userId: existing.rows[0].id, created: false };

    const userId = cryptoUuidV7();
    await this.client.query(
      `INSERT INTO identity.users
        (id,email,email_normalized,phone,phone_normalized,full_name,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',clock_timestamp(),clock_timestamp(),1)
       ON CONFLICT (email_normalized) DO NOTHING`,
      [userId, email, emailNormalized, normalizeOptional(input.phone), normalizeOptional(input.phone)?.replace(/\\D/g, "") ?? null, input.fullName.trim()],
    );
    const resolved = await this.client.query("SELECT id::text FROM identity.users WHERE email_normalized=$1 FOR UPDATE", [emailNormalized]);
    if (!resolved.rows[0]) throw new Error("ONBOARDING_OWNER_CREATE_FAILED");
    return { userId: resolved.rows[0].id, created: resolved.rows[0].id === userId };
  }

  async createOnboarding(input: { id: string; actor: OnboardingActor; idempotencyKey: string; requestChecksum: string; correlationId: string; commercialReference?: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO tenancy.onboarding_operations
        (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS',clock_timestamp(),clock_timestamp(),1)`,
      [input.id, actorType(input.actor), input.actor.id, input.idempotencyKey, input.requestChecksum, input.correlationId, normalizeOptional(input.commercialReference)],
    );
  }

  async createTenant(input: { id: string; name: string; code?: string }): Promise<void> {
    const code = normalizeOptional(input.code);
    await this.client.query(
      `INSERT INTO tenancy.tenants (id,name,code,code_normalized,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,'ACTIVE',clock_timestamp(),clock_timestamp(),1)`,
      [input.id, input.name.trim(), code, code?.toLowerCase() ?? null],
    );
  }

  async createCompany(input: { id: string; tenantId: string; name: string; legalName?: string; taxId?: string; email?: string; phone?: string; timezone: string; currency: string }): Promise<void> {
    const taxId = normalizeOptional(input.taxId);
    const phone = normalizeOptional(input.phone);
    await this.client.query(
      `INSERT INTO organization.companies
        (id,tenant_id,legal_name,trade_name,tax_id,tax_id_normalized,email,phone,phone_normalized,timezone,currency_code,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,normalizeOptional(input.legalName),input.name.trim(),taxId,taxId?.trim() ?? null,normalizeOptional(input.email),phone,phone?.replace(/\\D/g,"") ?? null,input.timezone.trim(),input.currency],
    );
  }

  async createBranch(input: { id: string; tenantId: string; companyId: string; name: string; code?: string; address?: string; city?: string; timezone: string }): Promise<void> {
    const code = normalizeOptional(input.code);
    await this.client.query(
      `INSERT INTO organization.branches
        (id,tenant_id,company_id,name,code,code_normalized,address,city,timezone,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,input.companyId,input.name.trim(),code,code?.toLowerCase() ?? null,normalizeOptional(input.address),normalizeOptional(input.city),input.timezone.trim()],
    );
  }

  async createOwnerMembership(input: { id: string; tenantId: string; userId: string; actor: OnboardingActor }): Promise<void> {
    await this.client.query(
      `INSERT INTO tenancy.tenant_memberships
        (id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_by_actor_id,created_at,activated_at,version)
       VALUES ($1,$2,$3,'OWNER','ACTIVE',true,$4,$5,clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,input.userId,input.actor.type,input.actor.id],
    );
  }

  async assignInitialOwnerRole(input: { id: string; tenantId: string; membershipId: string; companyId: string; branchId: string; actor: OnboardingActor }): Promise<void> {
    const role = await this.client.query(
      "SELECT id::text FROM \"authorization\".roles WHERE code='OWNER' AND status='ACTIVE' ORDER BY version DESC LIMIT 1 FOR SHARE",
    );
    if (!role.rows[0]) throw new Error("ONBOARDING_OWNER_ROLE_NOT_MATERIALIZED");
    await this.client.query(
      `INSERT INTO "authorization".user_role_assignments
        (id,tenant_id,tenant_membership_id,role_id,company_id,branch_id,status,valid_from,created_at,created_by_actor_type,created_by_actor_id,version)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',clock_timestamp(),clock_timestamp(),$7,$8,1)`,
      [input.id,input.tenantId,input.membershipId,role.rows[0].id,input.companyId,input.branchId,input.actor.type,input.actor.id],
    );
  }

  async applyInitialConfiguration(input: { onboardingId: string; tenantId: string; locale: string; timezone: string; currency: string; taxProfile?: string; configuration: Record<string, unknown> }): Promise<void> {
    const allowed = new Set(["pricingPolicyVersion","taxPolicyVersion","roundingPolicyVersion","authorizationPolicyVersionId"]);
    for (const key of Object.keys(input.configuration)) if (!allowed.has(key)) throw new Error("ONBOARDING_CONFIGURATION_UNSUPPORTED_" + key);
    const pricing = typeof input.configuration.pricingPolicyVersion === "string" ? input.configuration.pricingPolicyVersion : null;
    const tax = typeof input.configuration.taxPolicyVersion === "string" ? input.configuration.taxPolicyVersion : normalizeOptional(input.taxProfile);
    const rounding = typeof input.configuration.roundingPolicyVersion === "string" ? input.configuration.roundingPolicyVersion : null;
    const authorization = typeof input.configuration.authorizationPolicyVersionId === "string" ? input.configuration.authorizationPolicyVersionId : null;
    await this.client.query(
      `UPDATE tenancy.onboarding_operations
          SET pricing_policy_version=$2,tax_policy_version=$3,rounding_policy_version=$4,authorization_policy_version_id=$5,updated_at=clock_timestamp(),version=version+1
        WHERE id=$1`,
      [input.onboardingId,pricing,tax,rounding,authorization],
    );
  }

  private currentOnboardingId = "";
  setOnboardingId(id: string): void { this.currentOnboardingId = id; }

  async completeOnboarding(input: { onboardingId: string; tenantId: string; companyId: string; branchId: string; ownerUserId: string; membershipId: string; status: "READY_FOR_LICENSE" | "READY_FOR_ACTIVATION" | "COMPLETED"; licenseReference?: string; requestedPlan?: string; correlationId: string }): Promise<OnboardingResult> {
    const result = await this.client.query(
      `UPDATE tenancy.onboarding_operations
          SET tenant_id=$2,company_id=$3,branch_id=$4,owner_user_id=$5,tenant_membership_id=$6,
              status=$7,license_reference=$8,requested_plan=$9,updated_at=clock_timestamp(),version=version+1,
              completed_at=CASE WHEN $7='COMPLETED' THEN clock_timestamp() ELSE completed_at END
        WHERE id=$1
        RETURNING id::text,tenant_id::text,company_id::text,branch_id::text,owner_user_id::text,tenant_membership_id::text,
                  status,reason_code,license_reference,requested_plan,correlation_id::text,idempotency_key,created_at,updated_at`,
      [input.onboardingId,input.tenantId,input.companyId,input.branchId,input.ownerUserId,input.membershipId,input.status,input.licenseReference ?? null,input.requestedPlan ?? null],
    );
    if (!result.rows[0]) throw new Error("ONBOARDING_COMPLETION_FAILED");
    return mapOnboarding(result.rows[0]);
  }

  async audit(input: { onboardingId: string; tenantId: string; actor: OnboardingActor; actionCode: string; resourceType: string; resourceId?: string; operationId?: string; correlationId: string; result: string; reasonCode?: string; newValue?: unknown }): Promise<void> {
    const sanitized = input.newValue ?? null;
    await this.client.query(
      `INSERT INTO audit.audit_events
        (id,tenant_id,company_id,branch_id,actor_type,actor_id,action_code,resource_type,resource_reference_kind,resource_id,operation_id,correlation_id,schema_version,reported_at,server_recorded_at,result,reason_code,new_value,payload_checksum)
       VALUES ($1,$2,NULL,NULL,$3,$4,$5,$6,'INSTANCE',$7,$8,$9,1,clock_timestamp(),clock_timestamp(),$10,$11,$12,$13)`,
      [cryptoUuidV7(),input.tenantId,input.actor.type,input.actor.id,input.actionCode,input.resourceType,input.resourceId ?? input.tenantId,input.operationId ?? null,input.correlationId,input.result,input.reasonCode ?? null,sanitized,checksum(sanitized)],
    );
  }

  async recordSyncOperation(input: { operationId: string; tenantId: string; companyId: string; branchId: string; actor: OnboardingActor; aggregateId: string; operationType: string; correlationId: string; payload: Record<string, unknown>; payloadChecksum: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO sync.sync_operations
        (id,tenant_id,company_id,branch_id,source_kind,actor_type,actor_id,aggregate_type,aggregate_id,operation_type,idempotency_key,authority_policy,correlation_id,schema_version,payload,payload_checksum,sync_status,version)
       VALUES ($1,$2,$3,$4,'CENTRAL_SERVICE',$5,$6,'TENANT',$7,$8,$9,'SERVER_AUTHORITATIVE',$10,1,$11::jsonb,decode($12,'hex'),'READY_TO_SYNC',1)`,
      [input.operationId,input.tenantId,input.companyId,input.branchId,input.actor.type,input.actor.id,input.aggregateId,input.operationType,input.operationId,input.correlationId,JSON.stringify(input.payload),input.payloadChecksum],
    );
  }

  async recordOutbox(input: { id: string; tenantId: string; operationId: string; operationType: string; correlationId: string; payloadChecksum: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO sync.outbox_entries
        (id,tenant_id,operation_id,operation_type,schema_version,payload_checksum,correlation_id,sync_status,created_at,available_at,version)
       VALUES ($1,$2,$3,$4,1,decode($5,'hex'),$6,'READY_TO_SYNC',clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,input.operationId,input.operationType,input.payloadChecksum,input.correlationId],
    );
  }
}

function cryptoUuidV7(): string {
  const bytes = Buffer.from(randomBytes(16));
  const timestamp = BigInt(Date.now());
  for (let index=5; index>=0; index--) { bytes[index]=Number((timestamp >> BigInt((5-index)*8)) & 0xffn); }
  bytes[6]=(bytes[6]!&0x0f)|0x70; bytes[8]=(bytes[8]!&0x3f)|0x80;
  const hex=bytes.toString("hex");
  return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
}

export class PostgresOnboardingRepository implements OnboardingRepository {
  constructor(private readonly options: PostgresOnboardingRepositoryOptions) {}
  async transaction<T>(work: (tx: OnboardingTransaction) => Promise<T>): Promise<T> {
    const client = await this.options.pool.connect();
    const tx = new PostgresOnboardingTransaction(client);
    try {
      await client.query("BEGIN");
      const result = await work(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
