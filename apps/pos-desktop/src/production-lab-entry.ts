import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLabProvisioning } from "./lab-provisioning.js";
import { startProductionDesktop } from "./production-bootstrap.js";

/**
 * Arranque de producción para un equipo de LABORATORIO: la misma ruta que
 * `production-entry.ts`, con la identidad tomada del `provisioning.json` que
 * dejó `install-service.ps1 -Lab` en vez de variables puestas a mano.
 *
 * Ruta por defecto: el estado de laboratorio del servicio en este mismo
 * repositorio (`apps/pos-local-service/.lab-state`, fuera de `dist/` para que
 * recompilar no lo borre), relativa al bundle emitido en `apps/pos-desktop/dist/`.
 * `--provisioning=<ruta>` la sustituye.
 */
const override = process.argv.find((argument) => argument.startsWith("--provisioning="));
const path = override === undefined
  ? resolve(dirname(fileURLToPath(import.meta.url)), "../../pos-local-service/.lab-state/provisioning.json")
  : override.slice("--provisioning=".length);

if (!existsSync(path)) {
  throw new Error(
    `No existe ${path}. Instala antes el servicio de laboratorio (PowerShell como administrador): `
    + ".\\apps\\pos-local-service\\service\\install-service.ps1 -Lab -DevRolePreset ADMIN",
  );
}

startProductionDesktop({ ...process.env, ...parseLabProvisioning(readFileSync(path, "utf8")) });
