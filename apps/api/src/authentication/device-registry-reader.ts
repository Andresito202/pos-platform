import type { Pool } from "pg";
import type { CentralDeviceRegistryRow } from "@pos-platform/device-trust";

/**
 * Lectura de sólo consulta sobre `identity.device_registry` (migración 004).
 *
 * No importa `PostgresDeviceRegistryRepository` de `apps/central-authority`:
 * esa clase también escribe (`consumeActivationAndIssueCredential`, la mitad
 * de aprovisionamiento que `DEC-022` reserva a esa única autoridad), y una
 * app no importa de otra app — el tipo de fila sí es compartido, desde
 * `@pos-platform/device-trust`. Este lector repite la misma consulta de
 * sólo lectura porque repetir un `SELECT` no es «copiar el persistence
 * gate»: es la única forma correcta de que dos procesos lean la misma
 * tabla sin compartir runtime.
 */
export class DeviceRegistryReader {
  constructor(private readonly pool: Pool) {}

  async findActiveDevice(deviceId: string): Promise<CentralDeviceRegistryRow | null> {
    const result = await this.pool.query<Omit<CentralDeviceRegistryRow, "device_public_key"> & { device_public_key: Buffer }>(
      `SELECT device_id::text, installation_id::text, tenant_id::text, company_id::text,
              device_key_id, device_public_key, status, trust_key_id, trust_key_purpose
         FROM identity.device_registry
        WHERE device_id = $1 AND status = 'ACTIVE'`,
      [deviceId],
    );
    const row = result.rows[0];
    return row ? { ...row, device_public_key: Buffer.from(row.device_public_key).toString("utf8") } : null;
  }
}
