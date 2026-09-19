import { createPublicKey, type KeyObject } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { TrustedSigningKey, TrustedSigningKeyStatus } from "./license-verifier.js";

/**
 * El ancla de confianza del equipo — `DEC-011` §«Modelo de confianza
 * criptográfica».
 *
 * Convierte las filas de `local_trust_anchor` en el
 * `ReadonlyMap<string, TrustedSigningKey>` que consumen los tres verificadores
 * —sesión, snapshot de autorización y licencia—. Hasta `MIGRATION_022` ese
 * mapa no tenía origen posible y `main.ts` pasaba uno vacío, de modo que
 * `session.activate` fallaba cerrado y con él toda la superficie comercial.
 *
 * ## Lo que este almacén no hace, y no es olvido
 *
 * **No firma.** Guarda públicas. **No aprovisiona por su cuenta**: nada aquí
 * inventa un ancla ni la genera al arrancar, porque `DEC-011` deja el material
 * de producción `BLOCKED` «hasta disponer de material real» y prohíbe los
 * autofirmados como sustituto. Un equipo sin anclas provisionadas sigue sin
 * poder operar; es la consecuencia aceptada del modelo fail-closed.
 *
 * ## Fail-closed en la lectura, no sólo en la verificación
 *
 * Una fila cuya clave no se pueda interpretar **se descarta**, no se propaga
 * como error. Un ancla ilegible es indistinguible de un ancla ausente para
 * quien verifica, y lo contrario —dejar que una fila corrupta tumbe el
 * arranque— convertiría un problema de una clave en la caída del POS entero,
 * incluido el caso en que otra ancla válida bastaba para seguir trabajando.
 * Las revocadas no se cargan en absoluto: `REVOKED` no verifica nada, ni
 * siquiera histórico.
 */

export const TRUST_ANCHOR_PURPOSES = [
  "SESSION_ASSERTION",
  "AUTHORIZATION_SNAPSHOT",
  "LICENSE",
] as const;

export type TrustAnchorPurpose = (typeof TRUST_ANCHOR_PURPOSES)[number];

export interface TrustAnchorRecord {
  readonly purpose: TrustAnchorPurpose;
  readonly keyId: string;
  /** DER SPKI en `base64url`. Público por definición. */
  readonly publicKeySpki: string;
  readonly status: TrustedSigningKeyStatus;
}

interface AnchorRow {
  key_id: string;
  public_key_spki: string;
  status: TrustedSigningKeyStatus;
}

function toKeyObject(spkiBase64Url: string): KeyObject | null {
  try {
    return createPublicKey({
      key: Buffer.from(spkiBase64Url, "base64url"),
      format: "der",
      type: "spki",
    });
  } catch {
    // Ver el comentario de cabecera: una clave ilegible es un ancla menos, no
    // un arranque roto.
    return null;
  }
}

export class SqliteTrustAnchorStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Las anclas utilizables de un propósito, listas para un verificador.
   *
   * `ACTIVE` y `VERIFY_ONLY` entran; `REVOKED` no. La distinción es de
   * `DEC-011`: `VERIFY_ONLY` valida lo emitido con la clave anterior sin
   * admitir emisiones nuevas, que es lo que permite rotar sin ventana de
   * corte. Quien verifica recibe el estado y decide; este almacén no decide
   * por él.
   */
  keysFor(purpose: TrustAnchorPurpose): ReadonlyMap<string, TrustedSigningKey> {
    const rows = this.database.native.prepare(
      `SELECT key_id, public_key_spki, status FROM local_trust_anchor
       WHERE purpose=? AND status <> 'REVOKED'`,
    ).all(purpose) as AnchorRow[];

    const keys = new Map<string, TrustedSigningKey>();
    for (const row of rows) {
      const key = toKeyObject(row.public_key_spki);
      if (key === null) continue;
      keys.set(row.key_id, { key, status: row.status });
    }
    return keys;
  }

  /**
   * Cuántas anclas **utilizables** hay por propósito. Para el log de arranque.
   *
   * Cuenta las que `keysFor` entrega, no las filas de la tabla: una fila con
   * material ilegible no verificará nada, y decir que existe sería informar de
   * una confianza que no hay. Un operador que lee `session_assertion: 0` en el
   * arranque sabe por qué el POS rechaza cada sesión; uno que lee `1` teniendo
   * sólo una fila corrupta no sabría nada.
   */
  usableCount(purpose: TrustAnchorPurpose): number {
    return this.keysFor(purpose).size;
  }

  /**
   * Provisiona o actualiza un ancla.
   *
   * No lo invoca el runtime: lo invocará el aprovisionamiento —hoy inexistente
   * (`LIC-003`/`DEV-003`)— y lo invocan los tests con material generado para
   * la prueba, que es lo que `DEC-011` autoriza expresamente.
   *
   * Es idempotente por `(purpose, key_id)`. Rechaza una clave que no se pueda
   * interpretar: aquí sí se lanza, porque provisionar es un acto deliberado y
   * guardar material ilegible sería aceptar en silencio un ancla que nunca
   * verificará nada.
   */
  provision(record: TrustAnchorRecord): void {
    if (toKeyObject(record.publicKeySpki) === null) {
      throw new Error(`trust anchor ${record.purpose}/${record.keyId} is not a readable Ed25519 public key`);
    }

    const nowIso = this.now().toISOString();
    const revokedAt = record.status === "REVOKED" ? nowIso : null;

    this.database.native.prepare(
      `INSERT INTO local_trust_anchor(
        purpose, key_id, algorithm, public_key_spki, status,
        provisioned_at, updated_at, revoked_at
      ) VALUES (?,?,'ED25519',?,?,?,?,?)
      ON CONFLICT(purpose, key_id) DO UPDATE SET
        public_key_spki=excluded.public_key_spki,
        status=excluded.status,
        updated_at=excluded.updated_at,
        revoked_at=excluded.revoked_at`,
    ).run(
      record.purpose, record.keyId, record.publicKeySpki, record.status,
      nowIso, nowIso, revokedAt,
    );
  }
}
