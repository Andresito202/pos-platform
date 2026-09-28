import { win32 } from "node:path";
import * as z from "zod";

/**
 * `provisioning.json` que escribe `install-service.ps1 -Lab` junto al servicio.
 *
 * La ventana de Electron y el servicio deben presentar la MISMA
 * `installation_id` (nombra la named pipe) y el MISMO `device_id` (el servicio
 * los compara en el handshake), y leer el secreto del canal del MISMO
 * directorio de datos. Leerlos del fichero que escribió el instalador evita
 * copiarlos a mano, que es donde dos valores divergen sin que nada falle hasta
 * el handshake.
 */
const LabProvisioningSchema = z.object({
  kind: z.literal("LAB"),
  installation_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  device_id: z.uuid(),
  data_directory: z.string().min(1).refine((value) => win32.isAbsolute(value), "data_directory must be absolute"),
  /**
   * `true` cuando el laboratorio se instaló con login central
   * (`install-service.ps1 -Lab -CentralLogin`): la ventana exige iniciar sesión.
   */
  central_login: z.boolean().optional(),
});

export interface LabDesktopEnvironment {
  readonly POS_DATA_DIRECTORY: string;
  readonly POS_INSTALLATION_ID: string;
  readonly POS_DEVICE_ID: string;
  readonly POS_DESKTOP_REQUIRE_LOGIN?: "1";
}

export function parseLabProvisioning(text: string): LabDesktopEnvironment {
  // Windows PowerShell 5.1 escribe UTF-8 con BOM por defecto; `JSON.parse` no lo admite.
  const parsed = LabProvisioningSchema.parse(JSON.parse(text.replace(/^﻿/, "")));
  return {
    POS_DATA_DIRECTORY: parsed.data_directory,
    POS_INSTALLATION_ID: parsed.installation_id,
    POS_DEVICE_ID: parsed.device_id,
    ...(parsed.central_login === true ? { POS_DESKTOP_REQUIRE_LOGIN: "1" as const } : {}),
  };
}
