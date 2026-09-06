import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  SessionAssertionClaimsSchema,
  type SignedSessionAssertion,
} from "@pos-platform/contracts";
import type {
  SessionActivationOutcome,
  SessionAssertionStore,
  SessionBinding,
  StoredSessionAssertion,
} from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";

/**
 * Resultado de buscar la sesión activa de un dispositivo. `AMBIGUOUS` es un
 * resultado legítimo, no un error: significa que el dispositivo tiene más de
 * una sesión vigente y que ninguna puede recuperarse sin adivinar.
 */
export type DeviceSessionLookup =
  | { readonly kind: "FOUND"; readonly session: StoredSessionAssertion }
  | { readonly kind: "NONE" }
  | { readonly kind: "AMBIGUOUS" };

interface SessionRow {
  claims_json: string;
  claims_checksum: string;
  signature: string;
  sequence: number;
  offline_valid_until: string;
  activated_at: string;
}

/**
 * Implementación SQLite del puerto de sesión (SSA-003).
 *
 * `local_session_assertion` tiene como clave primaria el binding completo, así
 * que la activación es un reemplazo en sitio: no hay un instante en el que
 * coexistan dos sesiones activas para el mismo usuario/instalación/dispositivo.
 *
 * Reproduce el patrón ya probado en `SqliteAuthorizationSnapshotStore`: no
 * verifica firmas —eso es SSA-002—, compara la secuencia dentro de la misma
 * transacción que escribe, y comprueba la integridad de la fila al leerla.
 */
export class SqliteSessionAssertionStore implements SessionAssertionStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  activate(
    signed: SignedSessionAssertion,
    binding: SessionBinding,
  ): SessionActivationOutcome {
    const claims = SessionAssertionClaimsSchema.parse(signed.claims);

    // La SSA se archiva bajo su propio binding: activarla para otro sería
    // guardarla bajo una clave que no le corresponde.
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
    // Ésta es la comparación definitiva; el baseline que el servicio pasa al
    // verificador es una comprobación temprana, no la autoridad.
    const transaction = this.database.native.transaction((): SessionActivationOutcome => {
      const current = this.database.native.prepare(
        "SELECT sequence FROM local_session_assertion WHERE user_id=? AND installation_id=? AND device_id=?",
      ).get(binding.userId, binding.installationId, binding.deviceId) as
        | { sequence: number }
        | undefined;

      // Estrictamente mayor: una secuencia igual es un reenvío de la sesión
      // vigente y una menor es un replay; ninguna desplaza a la activa.
      if (current !== undefined && claims.sequence <= current.sequence) {
        return { kind: "STALE_SEQUENCE", currentSequence: current.sequence };
      }

      this.database.native.prepare(`
        INSERT INTO local_session_assertion(
          user_id, installation_id, device_id, session_id, tenant_membership_id,
          sequence, issued_at, offline_valid_until, key_id,
          claims_json, claims_checksum, signature, activated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id, installation_id, device_id) DO UPDATE SET
          session_id=excluded.session_id,
          tenant_membership_id=excluded.tenant_membership_id,
          sequence=excluded.sequence,
          issued_at=excluded.issued_at,
          offline_valid_until=excluded.offline_valid_until,
          key_id=excluded.key_id,
          claims_json=excluded.claims_json,
          claims_checksum=excluded.claims_checksum,
          signature=excluded.signature,
          activated_at=excluded.activated_at
      `).run(
        claims.user_id,
        claims.installation_id,
        claims.device_id,
        claims.session_id,
        claims.tenant_membership_id,
        claims.sequence,
        claims.issued_at,
        claims.offline_valid_until,
        claims.key_id,
        claimsJson,
        checksum,
        signed.signature,
        activatedAt,
      );

      return { kind: "ACTIVATED", sequence: claims.sequence };
    });

    return transaction();
  }

  loadActive(binding: SessionBinding): StoredSessionAssertion | null {
    const row = this.read(binding);
    if (row === null) return null;

    // Fuera de la ventana temporal no hay sesión, y se comunica como ausencia:
    // no existe gracia offline. La fila permanece almacenada para que una SSA
    // antigua no pueda reentrar por replay.
    if (this.now().getTime() >= Date.parse(row.offline_valid_until)) return null;

    const claims = SessionAssertionClaimsSchema.parse(JSON.parse(row.claims_json));
    return { claims, signature: row.signature, activatedAt: row.activated_at };
  }

  /**
   * Sesión activa de **este dispositivo**, sin recibir `user_id` del llamador
   * — `DEC-015` §5.5.
   *
   * `session.recover` no puede pedir el binding a quien llama: aceptarlo sería
   * dejarle nombrar la identidad que va a recuperar. La consulta se ancla en
   * `installation_id` y `device_id`, ambos derivados de la configuración local,
   * y el `user_id` sale de la fila encontrada.
   *
   * La clave primaria admite varias filas por dispositivo (una por usuario), de
   * modo que puede haber más de una vigente. En ese caso se devuelve
   * `AMBIGUOUS` y **no se elige**: escoger una sería adivinar de quién es la
   * sesión, que es exactamente la suplantación que este contrato impide.
   *
   * Devolver la fila no la acredita. Quien la consuma debe volver a verificar
   * su firma.
   */
  loadActiveByDevice(installationId: string, deviceId: string): DeviceSessionLookup {
    const rows = this.database.native.prepare(
      `SELECT claims_json, claims_checksum, signature, sequence, offline_valid_until, activated_at
       FROM local_session_assertion
       WHERE installation_id=? AND device_id=?`,
    ).all(installationId, deviceId) as SessionRow[];

    const nowMs = this.now().getTime();
    const active = rows.filter((row) => nowMs < Date.parse(row.offline_valid_until));

    if (active.length === 0) return { kind: "NONE" };
    if (active.length > 1) return { kind: "AMBIGUOUS" };

    const row = active[0] as SessionRow;
    const checksum = createHash("sha256").update(row.claims_json).digest("hex");
    if (checksum !== row.claims_checksum) {
      throw new Error("stored session assertion failed its integrity checksum");
    }

    const claims = SessionAssertionClaimsSchema.parse(JSON.parse(row.claims_json));
    return {
      kind: "FOUND",
      session: { claims, signature: row.signature, activatedAt: row.activated_at },
    };
  }

  highestAcceptedSequence(binding: SessionBinding): number | null {
    const row = this.read(binding);
    // Deliberadamente sin filtro temporal: una sesión vencida sigue fijando la
    // cota anti-replay, y por eso una SSA anterior no puede reentrar después.
    return row === null ? null : row.sequence;
  }

  private read(binding: SessionBinding): SessionRow | null {
    const row = this.database.native.prepare(
      `SELECT claims_json, claims_checksum, signature, sequence, offline_valid_until, activated_at
       FROM local_session_assertion
       WHERE user_id=? AND installation_id=? AND device_id=?`,
    ).get(binding.userId, binding.installationId, binding.deviceId) as SessionRow | undefined;

    if (row === undefined) return null;

    // Integridad de la fila almacenada. No sustituye a la verificación de firma
    // —que sigue siendo la autoridad— pero impide consumir una SSA alterada en
    // disco sin darse cuenta.
    const checksum = createHash("sha256").update(row.claims_json).digest("hex");
    if (checksum !== row.claims_checksum) {
      throw new Error("stored session assertion failed its integrity checksum");
    }
    return row;
  }
}
