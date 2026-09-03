import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  AuthorizationSnapshotClaimsSchema,
  type SignedAuthorizationSnapshot,
} from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type {
  AuthorizationSnapshotStore,
  SnapshotActivationOutcome,
  SnapshotBinding,
  StoredAuthorizationSnapshot,
} from "./authorization-snapshot-store.js";

interface SnapshotRow {
  claims_json: string;
  claims_checksum: string;
  signature: string;
  sequence: number;
  expires_at: string;
  activated_at: string;
}

/**
 * Implementación SQLite del puerto de snapshots (SAS-002).
 *
 * `local_authorization_snapshot` tiene como clave primaria el binding completo,
 * así que la activación es un reemplazo en sitio: no hay un instante en el que
 * coexistan dos snapshots activos para el mismo usuario/instalación/dispositivo.
 */
export class SqliteAuthorizationSnapshotStore implements AuthorizationSnapshotStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  activate(
    signed: SignedAuthorizationSnapshot,
    binding: SnapshotBinding,
  ): SnapshotActivationOutcome {
    const claims = AuthorizationSnapshotClaimsSchema.parse(signed.claims);

    // El snapshot se archiva bajo su propio binding: activarlo para otro sería
    // guardarlo bajo una clave que no le corresponde.
    if (
      claims.user_id !== binding.userId
      || claims.installation_id !== binding.installationId
      || claims.device_id !== binding.deviceId
    ) {
      return { kind: "BINDING_MISMATCH" };
    }

    const claimsJson = canonicalJson(claims);
    const checksum = createHash("sha256").update(claimsJson).digest("hex");
    const activatedAt = this.now().toISOString();

    // La comparación de secuencia y la escritura comparten transacción: leer
    // fuera de ella dejaría una ventana en la que dos activaciones concurrentes
    // podrían leer la misma secuencia actual y ambas considerarse mayores.
    const transaction = this.database.native.transaction((): SnapshotActivationOutcome => {
      const current = this.database.native.prepare(
        "SELECT sequence FROM local_authorization_snapshot WHERE user_id=? AND installation_id=? AND device_id=?",
      ).get(binding.userId, binding.installationId, binding.deviceId) as
        | { sequence: number }
        | undefined;

      // Estrictamente mayor: una secuencia igual es un reenvío del snapshot
      // vigente y una menor es un replay; ninguna desplaza al activo.
      if (current !== undefined && claims.sequence <= current.sequence) {
        return { kind: "STALE_SEQUENCE", currentSequence: current.sequence };
      }

      this.database.native.prepare(`
        INSERT INTO local_authorization_snapshot(
          user_id, installation_id, device_id, snapshot_id, sequence,
          issued_at, expires_at, claims_json, claims_checksum, signature, activated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id, installation_id, device_id) DO UPDATE SET
          snapshot_id=excluded.snapshot_id,
          sequence=excluded.sequence,
          issued_at=excluded.issued_at,
          expires_at=excluded.expires_at,
          claims_json=excluded.claims_json,
          claims_checksum=excluded.claims_checksum,
          signature=excluded.signature,
          activated_at=excluded.activated_at
      `).run(
        claims.user_id,
        claims.installation_id,
        claims.device_id,
        claims.snapshot_id,
        claims.sequence,
        claims.issued_at,
        claims.expires_at,
        claimsJson,
        checksum,
        signed.signature,
        activatedAt,
      );

      return { kind: "ACTIVATED", sequence: claims.sequence };
    });

    return transaction();
  }

  loadActive(binding: SnapshotBinding): StoredAuthorizationSnapshot | null {
    const row = this.database.native.prepare(
      `SELECT claims_json, claims_checksum, signature, sequence, expires_at, activated_at
       FROM local_authorization_snapshot
       WHERE user_id=? AND installation_id=? AND device_id=?`,
    ).get(binding.userId, binding.installationId, binding.deviceId) as SnapshotRow | undefined;

    if (row === undefined) return null;

    // Integridad de la fila almacenada. No sustituye a la verificación de firma
    // —que sigue siendo la autoridad— pero impide consumir un snapshot alterado
    // en disco sin darse cuenta.
    const checksum = createHash("sha256").update(row.claims_json).digest("hex");
    if (checksum !== row.claims_checksum) {
      throw new Error("stored authorization snapshot failed its integrity checksum");
    }

    // Fuera de la ventana temporal no hay autorización, y se comunica como
    // ausencia: no existe gracia offline para autorización.
    if (this.now().getTime() >= Date.parse(row.expires_at)) return null;

    const claims = AuthorizationSnapshotClaimsSchema.parse(JSON.parse(row.claims_json));
    return { claims, signature: row.signature, activatedAt: row.activated_at };
  }
}
