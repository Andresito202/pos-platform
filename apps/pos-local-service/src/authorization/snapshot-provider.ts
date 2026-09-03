import type { SignedAuthorizationSnapshot } from "@pos-platform/contracts";
import type { SnapshotBinding } from "./authorization-snapshot-store.js";

/**
 * Puerto de adquisición del Signed Authorization Snapshot (SAS-003).
 *
 * El transporte productivo (HTTP hacia la API central) no existe aún; este
 * puerto desacopla la lógica de adquisición de su mecanismo de entrega. Los
 * tests usan un adaptador en memoria; la implementación HTTP se conectará aquí
 * sin tocar el servicio de adquisición.
 *
 * `fetch` lanza cuando el proveedor externo no está disponible. El llamador es
 * responsable de interpretar esa condición y preservar el snapshot local válido.
 */
export interface SnapshotProvider {
  fetch(binding: SnapshotBinding): Promise<SignedAuthorizationSnapshot>;
}
