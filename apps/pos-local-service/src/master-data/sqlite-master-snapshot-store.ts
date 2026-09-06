import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  CashRegisterMasterRowSchema,
  MASTER_SNAPSHOT_TYPE_CASH_REGISTER,
  type CashRegisterMasterRow,
  type MasterSnapshotClaims,
  type SignedMasterSnapshot,
} from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";

/**
 * Persistencia local del snapshot maestro y de su proyección (`DEC-013` §13).
 *
 * Dos conceptos separados y una sola tabla por cada uno:
 *
 * - `local_master_snapshot_artifact` conserva el artefacto recibido, append-only,
 *   porque de él depende que la procedencia declarada por un turno siga siendo
 *   resoluble (`DEC-012` §21.6, §27.4).
 * - `cash_register` es la proyección activa **y** la tabla de `D5`: una sola,
 *   no dos (`DEC-012` §31.2).
 *
 * No verifica firmas —eso es el verificador— y no decide autoridad. Compara la
 * coordenada dentro de la misma transacción que escribe, porque hacerlo fuera
 * dejaría una ventana en la que dos activaciones concurrentes podrían leer la
 * misma cota y ambas considerarse mayores.
 */

export interface MasterSnapshotScopeKey {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
}

export type MasterSnapshotActivationOutcome =
  | { readonly kind: "ACTIVATED"; readonly sequence: number; readonly activatedAt: string }
  | { readonly kind: "OBSOLETE_SEQUENCE"; readonly acceptedSequence: number }
  | { readonly kind: "DUPLICATE_SEQUENCE"; readonly acceptedSequence: number };

export interface StoredCashRegister extends CashRegisterMasterRow {
  readonly last_seen_sequence: number;
}

interface ArtifactRow {
  claims_json: string;
  claims_checksum: string;
  sequence: number;
}

export class SqliteMasterSnapshotStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Mayor coordenada aceptada localmente para el ámbito. Es una de las dos
   * entradas de `effective_floor`; la otra la aporta la autoridad central y hoy
   * está bloqueada por `B-3`.
   */
  highestAcceptedSequence(scope: MasterSnapshotScopeKey): number | null {
    const row = this.database.native.prepare(
      `SELECT MAX(sequence) AS sequence FROM local_master_snapshot_artifact
       WHERE snapshot_type=? AND tenant_id=? AND company_id=? AND branch_id=?`,
    ).get(
      MASTER_SNAPSHOT_TYPE_CASH_REGISTER,
      scope.tenantId,
      scope.companyId,
      scope.branchId,
    ) as { sequence: number | null } | undefined;
    return row?.sequence ?? null;
  }

  /**
   * `VERIFY → VALIDATE` ya ocurrieron cuando se llega aquí. Esta operación es
   * `WRITE → ACTIVATE`, y es atómica: artefacto, proyección y cota avanzan en un
   * único commit, o no avanza ninguno.
   */
  activate(
    signed: SignedMasterSnapshot,
    claims: MasterSnapshotClaims,
  ): MasterSnapshotActivationOutcome {
    const claimsJson = canonicalJson(claims);
    const checksum = createHash("sha256").update(claimsJson).digest("hex");
    const activatedAt = this.now().toISOString();

    const transaction = this.database.native.transaction((): MasterSnapshotActivationOutcome => {
      const current = this.highestAcceptedSequence({
        tenantId: claims.tenant_id,
        companyId: claims.company_id,
        branchId: claims.branch_id,
      });

      // Comparación definitiva. La que hizo el verificador fue temprana y no es
      // la autoridad: entre aquélla y ésta puede haber entrado otra activación.
      if (current !== null) {
        if (claims.sequence === current) {
          return { kind: "DUPLICATE_SEQUENCE", acceptedSequence: current };
        }
        if (claims.sequence < current) {
          return { kind: "OBSOLETE_SEQUENCE", acceptedSequence: current };
        }
      }

      this.database.native.prepare(
        `INSERT INTO local_master_snapshot_artifact
           (snapshot_type, tenant_id, company_id, branch_id, sequence, environment,
            key_id, issued_at, claims_json, claims_checksum, signature, activated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        claims.snapshot_type,
        claims.tenant_id,
        claims.company_id,
        claims.branch_id,
        claims.sequence,
        claims.environment,
        claims.key_id,
        claims.issued_at,
        claimsJson,
        checksum,
        signed.signature,
        activatedAt,
      );

      // Reemplazo completo del ámbito. `G1`: las filas ausentes **no se borran**
      // ni se marcan `RETIRED`; conservan su última presencia y por eso quedan
      // fuera de la vista activa. `RETIRED` sólo llega del maestro.
      const upsert = this.database.native.prepare(
        `INSERT INTO cash_register
           (id, tenant_id, company_id, branch_id, code, code_normalized, name,
            currency_code, status, created_at, retired_at, version, last_seen_sequence)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id, id) DO UPDATE SET
           company_id=excluded.company_id,
           branch_id=excluded.branch_id,
           code=excluded.code,
           code_normalized=excluded.code_normalized,
           name=excluded.name,
           currency_code=excluded.currency_code,
           status=excluded.status,
           created_at=excluded.created_at,
           retired_at=excluded.retired_at,
           version=excluded.version,
           last_seen_sequence=excluded.last_seen_sequence`,
      );

      for (const row of claims.payload) {
        upsert.run(
          row.id,
          row.tenant_id,
          row.company_id,
          row.branch_id,
          row.code,
          row.code_normalized,
          row.name,
          row.currency_code,
          row.status,
          row.created_at,
          row.retired_at,
          row.version,
          claims.sequence,
        );
      }

      // La evidencia de aceptación comparte transacción con la activación: una
      // proyección activa sin rastro auditable sería indistinguible de una
      // activación no ocurrida.
      this.recordAudit("MASTER_SNAPSHOT_ACCEPTED", claims.tenant_id, {
        snapshot_type: claims.snapshot_type,
        tenant_id: claims.tenant_id,
        company_id: claims.company_id,
        branch_id: claims.branch_id,
        sequence: claims.sequence,
        key_id: claims.key_id,
        environment: claims.environment,
        claims_checksum: checksum,
        rows: claims.payload.length,
      }, activatedAt);

      return { kind: "ACTIVATED", sequence: claims.sequence, activatedAt };
    });

    return transaction();
  }

  /**
   * Vista activa del ámbito: las filas cuya última presencia coincide con la
   * coordenada aceptada. Una caja ausente del último snapshot conserva su fila y
   * queda fuera de esta lista sin haber sido borrada ni reinterpretada.
   */
  activeRegisters(scope: MasterSnapshotScopeKey): readonly StoredCashRegister[] {
    const accepted = this.highestAcceptedSequence(scope);
    if (accepted === null) return [];
    return this.database.native.prepare(
      `SELECT id, tenant_id, company_id, branch_id, code, code_normalized, name,
              currency_code, status, created_at, retired_at, version, last_seen_sequence
       FROM cash_register
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND last_seen_sequence=?
       ORDER BY code_normalized`,
    ).all(scope.tenantId, scope.companyId, scope.branchId, accepted) as StoredCashRegister[];
  }

  /**
   * Artefacto exacto que produjo una coordenada. Es lo que hace resoluble la
   * procedencia congelada en un turno, y comprueba integridad al leer: una fila
   * alterada no se devuelve como si fuera evidencia.
   */
  artifactAt(scope: MasterSnapshotScopeKey, sequence: number): MasterSnapshotClaims | null {
    const row = this.database.native.prepare(
      `SELECT claims_json, claims_checksum, sequence FROM local_master_snapshot_artifact
       WHERE snapshot_type=? AND tenant_id=? AND company_id=? AND branch_id=? AND sequence=?`,
    ).get(
      MASTER_SNAPSHOT_TYPE_CASH_REGISTER,
      scope.tenantId,
      scope.companyId,
      scope.branchId,
      sequence,
    ) as ArtifactRow | undefined;
    if (!row) return null;

    const checksum = createHash("sha256").update(row.claims_json).digest("hex");
    if (checksum !== row.claims_checksum) return null;

    const parsed = JSON.parse(row.claims_json) as MasterSnapshotClaims;
    // El payload se revalida al leer: la integridad prueba que nadie tocó la
    // fila, no que su contenido siga satisfaciendo el contrato vigente.
    parsed.payload.forEach((entry) => CashRegisterMasterRowSchema.parse(entry));
    return parsed;
  }
  /**
   * Rastro de un snapshot rechazado. Un rechazo silencioso es indistinguible de
   * un artefacto que nunca llegó (`DEC-013` §19), así que se registra siempre
   * con su motivo, fuera de toda transacción de activación.
   */
  recordRejection(
    subjectId: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    this.recordAudit("MASTER_SNAPSHOT_REJECTED", subjectId, details, this.now().toISOString());
  }

  private recordAudit(
    eventType: string,
    subjectId: string,
    details: Readonly<Record<string, unknown>>,
    createdAt: string,
  ): void {
    this.database.native.prepare(
      "INSERT INTO local_security_audit (event_type, subject_id, details_json, created_at) VALUES (?,?,?,?)",
    ).run(eventType, subjectId, canonicalJson(details), createdAt);
  }
}
