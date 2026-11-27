import type { PoolClient } from "pg";

/** Resolve only a unique, active, centrally licensed branch for the exact verified device. */
export async function resolveCommercialDeviceBranch(c:PoolClient,b:{tenantId:string;deviceId:string;installationId:string;credentialId:string;companyId:string}):Promise<string|null>{
  const found=await c.query<{branch_id:string}>(`SELECT DISTINCT b.branch_id::text AS branch_id
    FROM licensing.license_activations a
    JOIN licensing.licenses l ON l.id=a.license_id AND l.tenant_id=a.tenant_id AND l.contract_status IN ('ACTIVE','PAST_DUE')
    JOIN licensing.license_entitlements e ON e.license_id=l.id AND e.capability_code='CASH_REGISTER' AND e.enabled=true
    JOIN identity.device_registry d ON d.device_id=a.device_id AND d.installation_id=a.installation_id
      AND d.tenant_id=a.tenant_id AND d.company_id=a.company_id AND d.status='ACTIVE'
    JOIN identity.device_credentials dc ON dc.credential_id=a.credential_id AND dc.device_id=d.device_id
      AND dc.installation_id=d.installation_id AND dc.tenant_id=d.tenant_id AND dc.company_id=d.company_id
      AND dc.device_key_id=d.device_key_id AND dc.trust_key_id=d.trust_key_id
      AND dc.status='ACTIVE' AND dc.key_purpose='DEVICE_TRUST' AND dc.issued_at<=clock_timestamp()
      AND dc.expires_at>clock_timestamp()
    CROSS JOIN LATERAL jsonb_array_elements(a.request_payload->'allocations') allocation
    JOIN licensing.cash_register_bindings b ON b.license_id=a.license_id AND b.tenant_id=a.tenant_id AND b.company_id=a.company_id
      AND b.register_id=(allocation->>'register_id')::uuid AND b.branch_id=(allocation->>'branch_id')::uuid
    JOIN cash.cash_registers cr ON cr.id=b.register_id AND cr.tenant_id=b.tenant_id AND cr.company_id=b.company_id AND cr.branch_id=b.branch_id AND cr.status='ACTIVE'
    JOIN organization.branches br ON br.id=b.branch_id AND br.tenant_id=b.tenant_id AND br.company_id=b.company_id AND br.status='ACTIVE'
    WHERE a.tenant_id=$1 AND a.device_id=$2 AND a.installation_id=$3 AND a.credential_id=$4 AND a.company_id=$5
      AND a.activation_status='ACTIVE' AND a.revoked_at IS NULL
      AND l.not_before<=clock_timestamp()
      AND ((l.deployment_mode='LOCAL_PERPETUAL' AND l.contract_status='ACTIVE' AND l.expires_at IS NULL)
        OR (l.deployment_mode='HYBRID' AND l.expires_at IS NOT NULL AND clock_timestamp()<l.expires_at+interval '72 hours'))
      AND (a.canonical_payload->>'not_before')::timestamptz<=clock_timestamp()
      AND ((l.deployment_mode='LOCAL_PERPETUAL' AND a.canonical_payload->'expires_at'='null'::jsonb)
        OR (l.deployment_mode='HYBRID' AND (a.canonical_payload->>'expires_at')::timestamptz>clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM identity.device_credentials newer
        WHERE newer.device_id=dc.device_id AND newer.generation>dc.generation)
    LIMIT 2`,[b.tenantId,b.deviceId,b.installationId,b.credentialId,b.companyId]);
  return found.rows.length===1?found.rows[0]!.branch_id:null;
}
