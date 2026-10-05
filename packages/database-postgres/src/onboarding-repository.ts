import { createHash } from "node:crypto";
import type { OnboardingActor, OnboardingRecord, OnboardingRepository, OnboardingResult, OnboardingTransaction } from "@pos-platform/application";
import type { SqlQueryExecutor } from "./sql.js";
import { uuidV7 } from "./sql.js";

export interface PostgresPoolClient extends SqlQueryExecutor { release(): void; }
export interface PostgresPoolLike { connect(): Promise<PostgresPoolClient>; }

function normalize(value: string): string { return value.trim().toLowerCase(); }
function normalizeOptional(value: string | undefined): string | null { const v = value?.trim(); return v ? v : null; }
function normalizeTaxId(value: string | undefined): string | null { return value ? value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase() : null; }

function mapOnboarding(row: Record<string, any>): OnboardingRecord {
  return {
    onboardingId: row.id, tenantId: row.tenant_id, companyId: row.company_id, branchId: row.branch_id,
    ownerUserId: row.owner_user_id, tenantMembershipId: row.tenant_membership_id, status: row.status,
    reasonCode: row.reason_code ?? null, licenseReference: row.license_reference ?? null,
    requestedPlan: row.requested_plan ?? null, correlationId: row.correlation_id, idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    requestChecksum: row.request_checksum, actor: { type: row.actor_type, id: row.actor_id },
  };
}

class PostgresOnboardingTransaction implements OnboardingTransaction {
  constructor(private readonly client: PostgresPoolClient) {}

  async setActorContext(actor: OnboardingActor): Promise<void> {
    await this.client.query("SELECT set_config('app.actor_id',$1,true)", [actor.id]);
  }
  async setTenantContext(tenantId: string): Promise<void> {
    await this.client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  }

  async findOnboarding(actor: OnboardingActor, idempotencyKey: string): Promise<OnboardingRecord | null> {
    const rows = await this.client.query<Record<string, any>>(
      `SELECT id::text, actor_type, actor_id::text, idempotency_key, request_checksum, correlation_id::text,
              tenant_id::text, company_id::text, branch_id::text, owner_user_id::text,
              tenant_membership_id::text, status, reason_code, license_reference, requested_plan,
              created_at, updated_at
         FROM tenancy.onboarding_operations
        WHERE actor_type=$1 AND actor_id=$2 AND idempotency_key=$3
        FOR UPDATE`,
      [actor.type, actor.id, idempotencyKey],
    );
    return rows[0] ? mapOnboarding(rows[0]) : null;
  }

  async resolveOrCreateOwner(input: { userId?: string; email: string; phone?: string; fullName: string }): Promise<{ userId: string; created: boolean }> {
    const email = input.email.trim();
    const emailNormalized = normalize(email);
    if (input.userId) {
      const rows = await this.client.query<Record<string, string>>(
        "SELECT id::text,email_normalized FROM identity.users WHERE id=$1 FOR UPDATE", [input.userId],
      );
      if (!rows[0]) throw new Error("ONBOARDING_OWNER_USER_NOT_FOUND");
      if (rows[0].email_normalized !== emailNormalized) throw new Error("ONBOARDING_OWNER_IDENTITY_MISMATCH");
      return { userId: rows[0].id, created: false };
    }

    const inserted = await this.client.query<Record<string, string>>(
      `INSERT INTO identity.users
        (id,email,email_normalized,phone,phone_normalized,full_name,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',clock_timestamp(),clock_timestamp(),1)
       ON CONFLICT ON CONSTRAINT users_email_normalized_uq DO NOTHING
       RETURNING id::text`,
      [uuidV7(), email, emailNormalized, normalizeOptional(input.phone), normalizeOptional(input.phone)?.replace(/\D/g, "") ?? null, input.fullName.trim()],
    );
    if (inserted[0]) return { userId: inserted[0].id, created: true };
    const existing = await this.client.query<Record<string, string>>(
      "SELECT id::text FROM identity.users WHERE email_normalized=$1 FOR UPDATE", [emailNormalized],
    );
    if (!existing[0]) throw new Error("ONBOARDING_OWNER_CREATE_FAILED");
    return { userId: existing[0].id, created: false };
  }

  async createOnboarding(input: { id: string; actor: OnboardingActor; idempotencyKey: string; requestChecksum: string; correlationId: string; commercialReference?: string }): Promise<{ claimed: boolean }> {
    try {
      const rows = await this.client.query<Record<string, string>>(
        `INSERT INTO tenancy.onboarding_operations
          (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',clock_timestamp(),clock_timestamp(),1)
         ON CONFLICT ON CONSTRAINT onboarding_operations_identity_uq DO NOTHING
         RETURNING id::text`,
        [input.id,input.actor.type,input.actor.id,input.idempotencyKey,input.requestChecksum,input.correlationId,normalizeOptional(input.commercialReference)],
      );
      return { claimed: rows.length === 1 };
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505" && pgError.constraint === "onboarding_operations_commercial_reference_uq") {
        throw new Error("ONBOARDING_COMMERCIAL_REFERENCE_CONFLICT");
      }
      throw error;
    }
  }

  async createTenant(input: { id: string; name: string; code?: string }): Promise<void> {
    const code = normalizeOptional(input.code);
    await this.client.query(
      `INSERT INTO tenancy.tenants(id,name,code,code_normalized,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,'ACTIVE',clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.name.trim(),code,code ? normalize(code) : null],
    );
  }

  async createCompany(input: { id: string; tenantId: string; name: string; legalName?: string; taxId?: string; email?: string; phone?: string; timezone: string; currency: string }): Promise<void> {
    const taxId = normalizeOptional(input.taxId);
    const taxIdNormalized = normalizeTaxId(input.taxId);
    const phone = normalizeOptional(input.phone);
    await this.client.query(
      `INSERT INTO organization.companies
        (id,tenant_id,legal_name,trade_name,tax_id,tax_id_normalized,email,phone,phone_normalized,timezone,currency_code,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,normalizeOptional(input.legalName),input.name.trim(),taxId,taxIdNormalized,normalizeOptional(input.email),phone,phone?.replace(/\D/g,"") ?? null,input.timezone.trim(),input.currency],
    );
  }

  async createBranch(input: { id: string; tenantId: string; companyId: string; name: string; code?: string; address?: string; city?: string; timezone: string }): Promise<void> {
    const code = normalizeOptional(input.code);
    await this.client.query(
      `INSERT INTO organization.branches
        (id,tenant_id,company_id,name,code,code_normalized,address,city,latitude,longitude,timezone,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,'ACTIVE',clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,input.companyId,input.name.trim(),code,code ? normalize(code) : null,normalizeOptional(input.address),normalizeOptional(input.city),input.timezone.trim()],
    );
  }

  async createOwnerMembership(input: { id: string; tenantId: string; userId: string; actor: OnboardingActor }): Promise<void> {
    const rows = await this.client.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM tenancy.tenant_memberships WHERE user_id=$1 AND is_primary AND status='ACTIVE') AS exists",
      [input.userId],
    );
    await this.client.query(
      `INSERT INTO tenancy.tenant_memberships
        (id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_by_actor_id,created_at,activated_at,version)
       VALUES ($1,$2,$3,'OWNER','ACTIVE',$4,$5,$6,clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,input.userId,rows[0]?.exists !== true,input.actor.type,input.actor.id],
    );
  }

  async assignInitialOwnerRole(input: { id: string; tenantId: string; membershipId: string; companyId: string; branchId: string; actor: OnboardingActor }): Promise<void> {
    const role = await this.client.query<{ id: string }>(
      `SELECT id::text FROM "authorization".roles
        WHERE code='OWNER' AND status='ACTIVE' AND scope_type='BUSINESS'
        ORDER BY version DESC LIMIT 1`,
    );
    if (!role[0]) throw new Error("ONBOARDING_OWNER_ROLE_NOT_MATERIALIZED");
    await this.client.query(
      `INSERT INTO "authorization".user_role_assignments
        (id,tenant_id,tenant_membership_id,role_id,company_id,branch_id,status,valid_from,valid_until,created_at,created_by_actor_type,created_by_actor_id,revoked_at,version)
       VALUES ($1,$2,$3,$4,$5,NULL,'ACTIVE',clock_timestamp(),NULL,clock_timestamp(),$6,$7,NULL,1)`,
      [input.id,input.tenantId,input.membershipId,role[0].id,input.companyId,input.actor.type,input.actor.id],
    );
  }

  async applyInitialConfiguration(input: { onboardingId: string; tenantId: string; locale: string; timezone: string; currency: string; taxProfile?: unknown; configuration: Record<string, unknown> }): Promise<void> {
    const allowed = new Set(["pricingPolicyVersion","taxPolicyVersion","roundingPolicyVersion","authorizationPolicyVersionId"]);
    for (const key of Object.keys(input.configuration)) if (!allowed.has(key)) throw new Error("ONBOARDING_CONFIGURATION_UNSUPPORTED_" + key);
    const pricing = typeof input.configuration.pricingPolicyVersion === "string" ? input.configuration.pricingPolicyVersion : null;
    const tax = typeof input.configuration.taxPolicyVersion === "string" ? input.configuration.taxPolicyVersion : typeof input.taxProfile === "string" ? input.taxProfile : null;
    const rounding = typeof input.configuration.roundingPolicyVersion === "string" ? input.configuration.roundingPolicyVersion : null;
    const authorization = typeof input.configuration.authorizationPolicyVersionId === "string" ? input.configuration.authorizationPolicyVersionId : null;
    await this.client.query(
      `UPDATE tenancy.onboarding_operations
          SET pricing_policy_version=$2,tax_policy_version=$3,rounding_policy_version=$4,authorization_policy_version_id=$5,updated_at=clock_timestamp(),version=version+1
        WHERE id=$1`,
      [input.onboardingId,pricing,tax,rounding,authorization],
    );
  }

  async completeOnboarding(input: { onboardingId: string; tenantId: string; companyId: string; branchId: string; ownerUserId: string; membershipId: string; status: "READY_FOR_LICENSE" | "READY_FOR_ACTIVATION" | "COMPLETED"; licenseReference?: string; requestedPlan?: string; correlationId: string }): Promise<OnboardingResult> {
    const rows = await this.client.query<Record<string, any>>(
      `UPDATE tenancy.onboarding_operations
          SET tenant_id=$2,company_id=$3,branch_id=$4,owner_user_id=$5,tenant_membership_id=$6,
              status='READY_FOR_LICENSE',license_reference=$7,requested_plan=$8,updated_at=clock_timestamp(),version=version+1
        WHERE id=$1
        RETURNING id::text,tenant_id::text,company_id::text,branch_id::text,owner_user_id::text,tenant_membership_id::text,
                  status,reason_code,license_reference,requested_plan,correlation_id::text,idempotency_key,request_checksum,created_at,updated_at`,
      [input.onboardingId,input.tenantId,input.companyId,input.branchId,input.ownerUserId,input.membershipId,input.licenseReference ?? null,input.requestedPlan ?? null],
    );
    if (!rows[0]) throw new Error("ONBOARDING_COMPLETION_FAILED");
    return mapOnboarding(rows[0]);
  }

  async audit(input: { onboardingId: string; tenantId: string | null; actor: OnboardingActor; actionCode: string; resourceType: string; resourceId?: string; operationId?: string; correlationId: string; result: string; reasonCode?: string; newValue?: unknown }): Promise<void> {
    const payload = JSON.stringify(input.newValue ?? null);
    await this.client.query(
      `INSERT INTO audit.audit_events
        (id,tenant_id,company_id,branch_id,actor_type,actor_id,session_id,device_id,action_code,resource_type,resource_reference_kind,resource_id,operation_id,correlation_id,schema_version,reported_at,server_recorded_at,result,reason_code,new_value,payload_checksum)
       VALUES ($1,$2,NULL,NULL,$3,$4,NULL,NULL,'INSTANCE',$5,$6,$7,1,clock_timestamp(),clock_timestamp(),$8,$9,$10::jsonb,encode(sha256(convert_to($10::jsonb::text,'UTF8')),'hex'))`,
      [uuidV7(),input.tenantId,input.actor.type,input.actor.id,input.actionCode,input.resourceType,input.resourceId ?? input.tenantId ?? input.onboardingId,input.operationId ?? null,input.correlationId,input.result,input.reasonCode ?? null,payload],
    );
  }

  async recordSyncOperation(input: { operationId: string; tenantId: string; companyId: string; branchId: string; actor: OnboardingActor; aggregateId: string; operationType: string; idempotencyKey: string; correlationId: string; payload: Record<string, unknown>; payloadChecksum: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO sync.sync_operations
        (id,tenant_id,company_id,branch_id,source_kind,device_id,installation_id,session_id,actor_type,actor_id,aggregate_type,aggregate_id,operation_type,idempotency_key,expected_version,authority_policy,parent_operation_id,causation_id,correlation_id,schema_version,payload,payload_checksum,sync_status,occurred_at_local,recorded_at_local,received_at_server,committed_at_server,version)
       VALUES ($1,$2,$3,$4,'CENTRAL_SERVICE',NULL,NULL,NULL,$5,$6,'TENANT',$7,$8,$9,NULL,'SERVER_AUTHORITATIVE',NULL,NULL,$10,1,$11::jsonb,decode($12,'hex'),'READY_TO_SYNC',NULL,NULL,clock_timestamp(),clock_timestamp(),1)`,
      [input.operationId,input.tenantId,input.companyId,input.branchId,input.actor.type,input.actor.id,input.aggregateId,input.operationType,input.idempotencyKey,input.correlationId,JSON.stringify(input.payload),input.payloadChecksum],
    );
  }

  async recordOutbox(input: { id: string; tenantId: string; operationId: string; operationType: string; correlationId: string; payloadChecksum: string }): Promise<void> {
    await this.client.query(
      `INSERT INTO sync.outbox_entries
        (id,tenant_id,operation_id,device_id,local_sequence,operation_type,schema_version,payload_checksum,correlation_id,causation_id,sync_status,created_at,available_at,attempt_count,updated_at,version)
       VALUES ($1,$2,$3,NULL,NULL,$4,1,decode($5,'hex'),$6,NULL,'READY_TO_SYNC',clock_timestamp(),clock_timestamp(),0,clock_timestamp(),1)`,
      [input.id,input.tenantId,input.operationId,input.operationType,input.payloadChecksum,input.correlationId],
    );
  }
}

class PostgresTransactionalSql implements import("./sql.js").TransactionalSql {
  constructor(private readonly pool: PostgresPoolLike) {}
  async withTransaction<T>(run: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
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

export class PostgresOnboardingRepository implements OnboardingRepository {
  constructor(private readonly pool: PostgresPoolLike) {}
  async transaction<T>(work: (tx: OnboardingTransaction) => Promise<T>): Promise<T> {
    return new PostgresTransactionalSql(this.pool).withTransaction((client) => work(new PostgresOnboardingTransaction(client)));
  }
}
