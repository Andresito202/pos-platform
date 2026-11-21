import { CashRegisterCreateSchema, CashRegisterEditSchema, CashRegisterRetireSchema, CashRegisterPageRequestSchema,
  CashRegisterMasterRowSchema, CashRegisterPageSchema, uuidV7, type LicenseActivationPolicy } from "@pos-platform/contracts";
import type { PoolClient } from "@pos-platform/database-postgres";
import type { AuthenticatedBusinessSession } from "./business-browser-session-authority.js";
import { requireCashRegisterBusinessAdministrator } from "./cash-register-business-authorization.js";

export class BusinessRejection extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}
const reject = (status: number, code: string): never => { throw new BusinessRejection(status, code); };
function row(value: Record<string, unknown>) {
  return CashRegisterMasterRowSchema.parse({ ...value, version: Number(value.version),
    created_at: (value.created_at as Date).toISOString(), retired_at: value.retired_at === null ? null : (value.retired_at as Date).toISOString() });
}

/** All SQL uses the authenticated handler's transaction and trusted tenant.
 * Active company identities reserve capacity before allocation. Historical
 * allocations remain reserved, as in LicenseCapacityAuthority; retirement by
 * itself cannot release an artifact potentially held offline. 029 has no
 * per-license reservation relation: the company ceiling remains conservative. */
export class BusinessCashRegisters {
  constructor(private readonly policy: LicenseActivationPolicy) {}
  async execute(c: PoolClient, session: AuthenticatedBusinessSession, operation: string, input: unknown) {
    const schema = operation === "list" ? CashRegisterPageRequestSchema : operation === "create" ? CashRegisterCreateSchema :
      operation === "edit" ? CashRegisterEditSchema : operation === "retire" ? CashRegisterRetireSchema : null;
    if (!schema) return reject(404, "BUSINESS_NOT_FOUND");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return reject(400, "CASH_REGISTER_REQUEST_INVALID");
    const r = parsed.data;
    // Same ordering as LicenseCapacityAuthority: license lock, then company.
    // This also serializes administration against concurrent GLOBAL allocation.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["license-capacity:" + r.licenseId]);
    // Lock before guard takes SHARE locks, avoiding a SHARE -> UPDATE upgrade
    // deadlock between two business requests. Every create locks this same row.
    const company = await c.query(`SELECT id,currency_code FROM organization.companies
      WHERE id=$1 AND tenant_id=$2 AND status='ACTIVE' FOR UPDATE`, [r.companyId, session.tenantId]);
    if (company.rowCount !== 1) return reject(403, "CASH_REGISTER_SCOPE_REJECTED");
    const actor = await requireCashRegisterBusinessAdministrator(c, session.sessionId, r.companyId, r.branchId);
    if (actor.tenantId !== session.tenantId || actor.userId !== session.userId) return reject(403, "CASH_REGISTER_SCOPE_REJECTED");
    // Existing paid quote is the company binding and paid-capacity source used
    // by LicenseCapacityAuthority. Client license IDs never confer authority.
    const licensed = await c.query(`SELECT q.included_registers,q.additional_registers,l.policy_version,q.terms_snapshot
      FROM licensing.licenses l
      JOIN payments.payments p ON l.commercial_reference='SUBSCRIPTION_PAYMENT:'||p.id::text AND p.status='CONFIRMED'
      JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
      JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id AND q.tenant_id=l.tenant_id AND q.plan_id=l.plan_id
      WHERE l.id=$1 AND l.tenant_id=$2 AND q.company_id=$3
        AND l.contract_status IN ('ACTIVE','PAST_DUE') AND l.not_before<=clock_timestamp()
        AND ((l.deployment_mode='LOCAL_PERPETUAL' AND l.expires_at IS NULL AND l.contract_status='ACTIVE')
          OR (l.deployment_mode='HYBRID' AND l.expires_at IS NOT NULL
            AND clock_timestamp()<l.expires_at+$4::int*interval '1 day'))
      FOR SHARE OF l,p,g,q`, [r.licenseId, session.tenantId, r.companyId, this.policy.subscription_grace_days]);
    const license = licensed.rows[0];
    if (licensed.rowCount !== 1 || license?.included_registers !== 1 ||
        license.terms_snapshot?.policy_reference !== license.policy_version ||
        !this.policy.accepted_contract_policy_references.includes(license.policy_version)) return reject(403, "CASH_REGISTER_LICENSE_REQUIRED");
    const entitlement = await c.query(`SELECT 1 FROM licensing.license_entitlements
      WHERE license_id=$1 AND capability_code='CASH_REGISTER' AND enabled=true FOR SHARE`, [r.licenseId]);
    if (entitlement.rowCount !== 1) return reject(403, "CASH_REGISTER_LICENSE_REQUIRED");
    const scope = [session.tenantId, r.companyId, r.branchId];
    if (operation === "list" && "after" in r) {
      const result = await c.query(`SELECT * FROM cash.cash_registers WHERE tenant_id=$1 AND company_id=$2 AND branch_id=$3
        AND ($4::uuid IS NULL OR id>$4::uuid) ORDER BY id LIMIT 101`, [...scope, r.after]);
      const registers = result.rows.slice(0, 100).map(row);
      return CashRegisterPageSchema.parse({ registers, nextCursor: result.rows.length > 100 ? registers[99]!.id : null });
    }
    if (!("id" in r) || !("correlationId" in r)) return reject(400, "CASH_REGISTER_REQUEST_INVALID");
    let changed;
    if (operation === "create" && "currency" in r) {
      if (r.currency !== company.rows[0].currency_code) return reject(400, "CASH_REGISTER_CURRENCY_MISMATCH");
      const existing = await c.query(`SELECT * FROM cash.cash_registers WHERE tenant_id=$1 AND company_id=$2 AND branch_id=$3 AND id=$4`, [...scope,r.id]);
      if (existing.rowCount) {
        // Creation's immutable acknowledgement survives later edit/retirement.
        // Never reinterpret today's mutable master row as the original request.
        const evidence = await c.query(`SELECT new_value,correlation_id FROM audit.audit_events
          WHERE tenant_id=$1 AND company_id=$2 AND branch_id=$3 AND resource_id=$4
            AND action_code='CASH_REGISTER_CREATE' AND resource_type='CASH_REGISTER' AND result='SUCCEEDED'
            AND payload_checksum=encode(sha256(convert_to(new_value::text,'UTF8')),'hex')
          ORDER BY server_recorded_at,id LIMIT 2`, [...scope,r.id]);
        const event = evidence.rows[0];
        const original = CashRegisterMasterRowSchema.safeParse(event?.new_value?.register);
        if (evidence.rowCount !== 1 || !original.success || event?.new_value?.licenseId !== r.licenseId ||
            event.correlation_id !== r.correlationId || original.data.id !== r.id || original.data.tenant_id !== session.tenantId ||
            original.data.company_id !== r.companyId || original.data.branch_id !== r.branchId ||
            original.data.code !== r.code || original.data.name !== r.name || original.data.currency_code !== r.currency) {
          return reject(409,"CASH_REGISTER_IDEMPOTENCY_CONFLICT");
        }
        return { register: original.data };
      }
      const capacity = Number(license.included_registers) + Number(license.additional_registers);
      if (!Number.isSafeInteger(capacity) || capacity < 1) return reject(403, "CASH_REGISTER_CAPACITY_INVALID");
      // 029 does not attribute unallocated identities to an individual license.
      // Do not invent how to pool capacities for multiple live company licenses.
      // This competing-license probe is MVCC-only: locking a different license
      // after the company would invert GLOBAL's license -> company ordering.
      const competing = await c.query(`SELECT l.id AS competing_license_id FROM licensing.licenses l
        JOIN payments.payments p ON l.commercial_reference='SUBSCRIPTION_PAYMENT:'||p.id::text AND p.status='CONFIRMED'
        JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
        JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id AND q.tenant_id=l.tenant_id AND q.plan_id=l.plan_id
        WHERE l.tenant_id=$1 AND q.company_id=$2 AND l.id<>$3 AND l.contract_status IN ('ACTIVE','PAST_DUE')
          AND l.not_before<=clock_timestamp()
          AND ((l.deployment_mode='LOCAL_PERPETUAL' AND l.expires_at IS NULL AND l.contract_status='ACTIVE')
            OR (l.deployment_mode='HYBRID' AND l.expires_at IS NOT NULL AND clock_timestamp()<l.expires_at+$4::int*interval '1 day'))
        LIMIT 1`, [session.tenantId,r.companyId,r.licenseId,this.policy.subscription_grace_days]);
      if (competing.rowCount !== 0) return reject(409,"CASH_REGISTER_LICENSE_BINDING_REQUIRED");
      const used = await c.query(`SELECT count(*)::text AS used FROM (
        SELECT id FROM cash.cash_registers WHERE tenant_id=$1 AND company_id=$2 AND status='ACTIVE'
        UNION
        SELECT (allocation->>'register_id')::uuid AS id
          FROM licensing.license_activations a
          CROSS JOIN LATERAL jsonb_array_elements(a.request_payload->'allocations') allocation
         WHERE a.tenant_id=$1 AND a.company_id=$2
      ) reserved`, scope.slice(0, 2));
      const count = Number(used.rows[0]?.used);
      if (used.rowCount !== 1 || !Number.isSafeInteger(count) || count < 0) return reject(403,"CASH_REGISTER_CAPACITY_INVALID");
      if (count >= capacity) return reject(409, "CASH_REGISTER_CAPACITY_EXHAUSTED");
      changed = await c.query(`INSERT INTO cash.cash_registers
        (id,tenant_id,company_id,branch_id,code,code_normalized,name,currency_code,status)
        VALUES ($4,$1,$2,$3,$5,$6,$7,$8,'ACTIVE') RETURNING *`, [...scope, r.id, r.code, r.code.toLowerCase(), r.name, r.currency]);
    } else if (operation === "edit" && "code" in r && "expectedVersion" in r) {
      changed = await c.query(`UPDATE cash.cash_registers SET code=$6,code_normalized=$7,name=$8,version=version+1
        WHERE tenant_id=$1 AND company_id=$2 AND branch_id=$3 AND id=$4 AND version=$5 AND status='ACTIVE' RETURNING *`,
        [...scope, r.id, r.expectedVersion, r.code, r.code.toLowerCase(), r.name]);
    } else if (operation === "retire" && "expectedVersion" in r) {
      changed = await c.query(`UPDATE cash.cash_registers SET status='RETIRED',retired_at=clock_timestamp(),version=version+1
        WHERE tenant_id=$1 AND company_id=$2 AND branch_id=$3 AND id=$4 AND version=$5 AND status='ACTIVE' RETURNING *`, [...scope, r.id, r.expectedVersion]);
    } else return reject(400, "CASH_REGISTER_REQUEST_INVALID");
    if (changed.rowCount !== 1) return reject(409, "CASH_REGISTER_VERSION_CONFLICT");
    const register = row(changed.rows[0]);
    const payload = JSON.stringify({ register, licenseId: r.licenseId });
    await c.query(`INSERT INTO audit.audit_events
      (id,tenant_id,company_id,branch_id,actor_type,actor_id,session_id,action_code,resource_type,resource_reference_kind,resource_id,
       correlation_id,schema_version,reported_at,server_recorded_at,result,new_value,payload_checksum)
      VALUES($1,$2,$3,$4,'USER',$5,$6,$7,'CASH_REGISTER','INSTANCE',$8,$9,1,clock_timestamp(),clock_timestamp(),'SUCCEEDED',$10::jsonb,encode(sha256(convert_to($10::jsonb::text,'UTF8')),'hex'))`,
      [uuidV7(), ...scope, session.userId, session.sessionId, "CASH_REGISTER_" + operation.toUpperCase(), r.id, r.correlationId,
        payload]);
    // Revocation/expiry during waiting or mutation must still fail the commit.
    await requireCashRegisterBusinessAdministrator(c, session.sessionId, r.companyId, r.branchId);
    return { register };
  }
}
