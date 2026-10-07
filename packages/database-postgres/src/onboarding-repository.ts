import type { OnboardingActor, OnboardingRecord, OnboardingRepository, OnboardingResult, OnboardingTransaction } from "@pos-platform/contracts";

import { uuidV7, type SqlQueryExecutor } from "./sql.js";

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
    const context = await this.client.query<{ actor_id: string | null }>(
      "SELECT set_config('app.actor_id',$1,true) AS actor_id",
      [actor.id],
    );
    if (context[0]?.actor_id !== actor.id) throw new Error("ONBOARDING_ACTOR_CONTEXT_MISMATCH:" + (context[0]?.actor_id ?? "<null>") + ":" + actor.id);
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
        WHERE actor_type=$1 AND actor_id=$2 AND idempotency_key=$3`,
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
      const existingUser = rows[0];
      if (!existingUser) throw new Error("ONBOARDING_OWNER_USER_NOT_FOUND");
      if (existingUser.email_normalized !== emailNormalized) throw new Error("ONBOARDING_OWNER_IDENTITY_MISMATCH");
      if (!existingUser.id) throw new Error("ONBOARDING_OWNER_USER_NOT_FOUND");
      return { userId: existingUser.id, created: false };
    }

    const inserted = await this.client.query<Record<string, string>>(
      `INSERT INTO identity.users
        (id,email,email_normalized,phone,phone_normalized,full_name,status,created_at,updated_at,version)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',clock_timestamp(),clock_timestamp(),1)
       ON CONFLICT ON CONSTRAINT users_email_normalized_uq DO NOTHING
       RETURNING id::text`,
      [uuidV7(), email, emailNormalized, normalizeOptional(input.phone), normalizeOptional(input.phone)?.replace(/\D/g, "") ?? null, input.fullName.trim()],
    );
    const insertedOwner = inserted[0];
    if (insertedOwner?.id) return { userId: insertedOwner.id, created: true };
    const existing = await this.client.query<Record<string, string>>(
      "SELECT id::text FROM identity.users WHERE email_normalized=$1 FOR UPDATE", [emailNormalized],
    );
    const existingOwner = existing[0];
    if (!existingOwner) throw new Error("ONBOARDING_OWNER_CREATE_FAILED");
    if (!existingOwner.id) throw new Error("ONBOARDING_OWNER_CREATE_FAILED");
    return { userId: existingOwner.id, created: false };
  }

  async createOnboarding(input: { id: string; actor: OnboardingActor; idempotencyKey: string; requestChecksum: string; correlationId: string; commercialReference?: string }): Promise<{ claimed: boolean }> {
    try {
      const rows = await this.client.query<Record<string, string>>(
        `INSERT INTO tenancy.onboarding_operations
          (id,actor_type,actor_id,idempotency_key,request_checksum,correlation_id,commercial_reference,status,created_at,updated_at,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',clock_timestamp(),clock_timestamp(),1)
         ON CONFLICT ON CONSTRAINT onboarding_operations_identity_uq
         DO UPDATE SET updated_at = tenancy.onboarding_operations.updated_at
         RETURNING id::text`,
        [input.id,input.actor.type,input.actor.id,input.idempotencyKey,input.requestChecksum,input.correlationId,normalizeOptional(input.commercialReference)],
      );
      const claimedRow = rows[0];
      return { claimed: claimedRow?.id === input.id };
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

  async createOwnerMembership(input: { id: string; tenantId: string; userId: string; actor: OnboardingActor; isPrimary: boolean }): Promise<void> {
    await this.client.query(
      `INSERT INTO tenancy.tenant_memberships
        (id,tenant_id,user_id,membership_type,status,is_primary,created_by_actor_type,created_by_actor_id,created_at,activated_at,version)
       VALUES ($1,$2,$3,'OWNER','ACTIVE',$4,$5,$6,clock_timestamp(),clock_timestamp(),1)`,
      [input.id,input.tenantId,input.userId,input.isPrimary,input.actor.type,input.actor.id],
    );
  }

  async assignInitialOwnerRole(input: { id: string; tenantId: string; membershipId: string; companyId: string; branchId: string; actor: OnboardingActor }): Promise<void> {
    const role = await this.client.query<{ id: string }>(
      `SELECT id::text FROM "authorization".roles
        WHERE code='OWNER' AND status='ACTIVE' AND scope_type='BUSINESS'
        ORDER BY version DESC LIMIT 1`,
    );
    const ownerRole = role[0];
    if (!ownerRole) throw new Error("ONBOARDING_OWNER_ROLE_NOT_MATERIALIZED");