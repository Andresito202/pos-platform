import { generateKeyPairSync, sign } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { MasterSnapshotClaimsSchema, type MasterSnapshotClaims } from "@pos-platform/contracts";
import {
  MasterSnapshotActivationService,
  type MasterSnapshotAcceptanceOutcome,
} from "../master-data/master-snapshot-activation.js";
import { SqliteMasterSnapshotStore } from "../master-data/sqlite-master-snapshot-store.js";
import {
  MASTER_SNAPSHOT_KEY_PURPOSE,
  MasterSnapshotVerifier,
  unsignedMasterSnapshotBytes,
} from "../security/master-snapshot-verifier.js";
import type { TrustedClockGuard } from "../security/trusted-clock.js";

/**
 * Caja de laboratorio para la revisión de pantallas (`dev-only/`) — nunca
 * producción, nunca `DEC-013` real.
 *
 * ## Por qué existe
 *
 * En una instalación real **no hay forma de que exista una caja**: la única
 * vía es un snapshot maestro firmado por la central (`DEC-013`), cuyo emisor
 * está bloqueado por `B-3`, y `MasterSnapshotActivationService` no tenía
 * ningún llamador en producción. Toda prueba y el E2E insertaban la fila con un
 * `INSERT` directo y una firma de relleno. En un PC de laboratorio eso dejaba
 * `cash.shift.open` sin caja que abrir y, detrás, sin venta, recibo ni cajón.
 *
 * ## Por qué no es un `INSERT` directo
 *
 * Firma un snapshot `CASH_REGISTER` con una clave Ed25519 efímera de este
 * arranque y lo pasa por la ruta canónica completa —`MasterSnapshotVerifier` y
 * `MasterSnapshotActivationService`: VERIFY → VALIDATE → WRITE → ACTIVATE—.
 * Lo único sustituido es el emisor, exactamente como `dev-session-bootstrap.ts`
 * sustituye al emisor de SSA/SAS. Si la ruta real rechaza el snapshot, la caja
 * no existe y el motivo queda registrado.
 *
 * Sólo corre cuando `main.ts` ya aceptó `POS_DEV_ROLE_PRESET`, que `config.ts`
 * rechaza con `PRODUCTION` o con un artefacto real configurado.
 */

/** Fijo, igual que `PRESET_USER_ID`: el operador lo teclea en la pantalla de turno. */
export const DEV_LAB_REGISTER_ID = "00000000-0000-7000-8000-0000000000d5";
const DEV_LAB_MASTER_KEY_ID = "DEV-LOCAL-MASTER";
const DEV_LAB_ENVIRONMENT = "SANDBOX" as const;

export interface DevLabRegisterScope {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
}

export type DevLabRegisterOutcome =
  | { readonly kind: "ALREADY_PRESENT"; readonly registerId: string }
  | ({ readonly registerId: string } & MasterSnapshotAcceptanceOutcome);

export function activateDevLabRegister(
  database: LocalDatabase,
  trustedClock: TrustedClockGuard,
  scope: DevLabRegisterScope,
  now: () => Date = () => new Date(),
): DevLabRegisterOutcome {
  const store = new SqliteMasterSnapshotStore(database, now);
  // Una vez aceptada, la caja persiste: reemitir en cada arranque sólo haría
  // crecer el libro de artefactos sin cambiar nada.
  const accepted = store.highestAcceptedSequence(scope);
  if (accepted !== null) return { kind: "ALREADY_PRESENT", registerId: DEV_LAB_REGISTER_ID };

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const issuedAt = now().toISOString();
  const claims: MasterSnapshotClaims = MasterSnapshotClaimsSchema.parse({
    schema_version: 1,
    snapshot_type: "CASH_REGISTER",
    key_id: DEV_LAB_MASTER_KEY_ID,
    environment: DEV_LAB_ENVIRONMENT,
    tenant_id: scope.tenantId,
    company_id: scope.companyId,
    branch_id: scope.branchId,
    sequence: 1,
    issued_at: issuedAt,
    payload: [{
      id: DEV_LAB_REGISTER_ID,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      code: "CAJA-LAB",
      code_normalized: "caja-lab",
      name: "Caja de laboratorio",
      currency_code: "COP",
      status: "ACTIVE",
      created_at: issuedAt,
      retired_at: null,
      version: 1,
    }],
  });
  const signed = { claims, signature: sign(null, unsignedMasterSnapshotBytes(claims), privateKey).toString("base64url") };

  const verifier = new MasterSnapshotVerifier(
    new Map([[DEV_LAB_MASTER_KEY_ID, { key: publicKey, status: "ACTIVE" as const, purpose: MASTER_SNAPSHOT_KEY_PURPOSE }]]),
    trustedClock,
    now,
  );
  // Sin central no hay cota acusada: `null` es «sin acuse», no «cualquier cota».
  const service = new MasterSnapshotActivationService(verifier, store, { floorFor: () => null });
  const outcome = service.accept(signed, { ...scope, environment: DEV_LAB_ENVIRONMENT });
  return { ...outcome, registerId: DEV_LAB_REGISTER_ID };
}
