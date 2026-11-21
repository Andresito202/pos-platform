import type { PoolClient } from "@pos-platform/database-postgres";

export async function requireActiveBoundRegisters(c: PoolClient, source: {
  tenantId:string; companyId:string; licenseId:string;
}, allocations: readonly {register_id:string;branch_id:string}[]) {
  for(const a of [...allocations].sort((x,y)=>x.register_id.localeCompare(y.register_id))) {
    const register=await c.query(`SELECT r.id FROM cash.cash_registers r
      JOIN licensing.cash_register_bindings b ON b.register_id=r.id AND b.tenant_id=r.tenant_id
        AND b.company_id=r.company_id AND b.branch_id=r.branch_id AND b.license_id=$5
      WHERE r.id=$1 AND r.tenant_id=$2 AND r.company_id=$3 AND r.branch_id=$4 AND r.status='ACTIVE'
      FOR SHARE OF r`,[a.register_id,source.tenantId,source.companyId,a.branch_id,source.licenseId]);
    if(register.rowCount!==1)throw Error("LICENSE_ACTIVE_BOUND_REGISTER_REQUIRED");
  }
}

/** Caller holds license-capacity advisory lock, paid license/source locks and
 * an authenticated transaction. Historical reservations never release on retire
 * or revoke: the existing offline release protocol has not been implemented. */
export async function reserveCashRegisterLicense(c: PoolClient, source: {
  tenantId: string; companyId: string; licenseId: string; capacity: number;
}, allocations: readonly { register_id: string; branch_id: string }[]) {
  if (!Number.isSafeInteger(source.capacity) || source.capacity < 1) throw Error("CASH_REGISTER_CAPACITY_INVALID");
  for (const a of [...allocations].sort((x,y) => x.register_id.localeCompare(y.register_id))) {
    await c.query(`INSERT INTO licensing.cash_register_bindings(register_id,tenant_id,company_id,branch_id,license_id)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(register_id) DO NOTHING`,
      [a.register_id,source.tenantId,source.companyId,a.branch_id,source.licenseId]);
    const binding = await c.query(`SELECT 1 FROM licensing.cash_register_bindings
      WHERE register_id=$1 AND tenant_id=$2 AND company_id=$3 AND branch_id=$4 AND license_id=$5`,
      [a.register_id,source.tenantId,source.companyId,a.branch_id,source.licenseId]);
    if (binding.rowCount !== 1) throw Error("CASH_REGISTER_LICENSE_BINDING_CONFLICT");
  }
  const used = await c.query(`SELECT count(*)::text AS used FROM licensing.cash_register_bindings WHERE license_id=$1`, [source.licenseId]);
  const count = Number(used.rows[0]?.used);
  if (used.rowCount !== 1 || !Number.isSafeInteger(count) || count < allocations.length) throw Error("CASH_REGISTER_CAPACITY_INVALID");
  if (count > source.capacity) throw Error("CASH_REGISTER_CAPACITY_EXHAUSTED");
}
