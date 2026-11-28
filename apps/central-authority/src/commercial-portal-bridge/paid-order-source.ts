import { CommercialPaidOrderBindingSchema, type LicenseActivationPolicy } from "@pos-platform/contracts";
import type { PoolClient } from "@pos-platform/database-postgres";

// Call in preproduction under the tenant context. The SQL authority is shared
// with the trigger that owns register-capacity reservations.
export async function findPaidCommercialOrder(c: PoolClient, licenseId: string, policy: LicenseActivationPolicy) {
  if (!policy.accepted_contract_policy_references.includes("COMMERCIAL_ORDER_V1")) return null;
  const row = (await c.query(`SELECT company_id AS id,trade_name,paid_order,plan_version
    FROM licensing.current_paid_commercial_order($1)`, [licenseId])).rows[0];
  return CommercialPaidOrderBindingSchema.safeParse(row?.paid_order).success ? row : null;
}
