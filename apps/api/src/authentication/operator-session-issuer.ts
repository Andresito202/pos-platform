import { sign, type KeyObject } from "node:crypto";
import {
  AuthorizationSnapshotClaimsSchema,
  OperatorSessionProvisioningArtifactSchema,
  SessionAssertionClaimsSchema,
  canonicalSessionTrustJson,
  uuidV7,
  type OperatorSessionProvisioningArtifact,
  type SnapshotAssignment,
} from "@pos-platform/contracts";
import { AUTHENTICATION_POLICY } from "./authentication-policy.js";
import { offlineValidUntil } from "./session-lifetimes.js";

/**
 * Emisión de los dos sobres que el POS necesita para operar tras un login
 * (`DEC-026` §13.10): la SSA —quién es el operador, `DEC-012`— y el SAS —qué
 * puede hacer, `DEC-011`—, con la misma forma que el artefacto de
 * aprovisionamiento de `DEC-025` (`OperatorSessionProvisioningArtifact`). El
 * POS los verifica por la ruta que ya usa para ese artefacto: no hay un
 * segundo camino de activación.
 *
 * **Una clave por propósito.** La SSA y el SAS se firman con claves distintas
 * porque el POS las busca en anclas distintas (`D-31`): quien pudiera firmar
 * identidad no debe poder firmar permisos.
 *
 * **La canonicalización es la del contrato** (`canonicalSessionTrustJson`),
 * byte a byte igual a la `canonicalJson` con la que verifica el POS; se firma
 * el resultado del parseo, no la entrada cruda, igual que verifica él.
 */

export interface SessionTrustSigningKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
}

/**
 * Una fila por asignación de rol vigente y permiso concedido a ese rol.
 * `permissionCode` es `null` cuando el rol no tiene ninguna concesión vigente:
 * la asignación existe igual, con la lista de permisos vacía.
 */
export interface AuthorizationProjectionRow {
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly permissionCode: string | null;
  readonly permissionStatus: "ACTIVE" | "RETIRED" | null;
}

export interface OperatorSessionIssueInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly sessionId: string;
  readonly installationId: string;
  readonly deviceId: string;
  readonly issuedAt: Date;
  readonly sessionExpiresAt: Date;
  /** De `identity.session_trust_sequence` (006): la monotonía es del emisor (`DEC-011`). */
  readonly sequence: number;
  readonly projection: readonly AuthorizationProjectionRow[];
}

/**
 * `DEC-011`: vigencia inicial del SAS. La del sobre emitido es la menor entre
 * ésta y la de la sesión, así que un administrador (12 h) nunca recibe
 * permisos que le sobrevivan.
 */
export function authorizationSnapshotExpiresAt(issuedAt: Date, sessionExpiresAt: Date): Date {
  return offlineValidUntil(
    sessionExpiresAt,
    new Date(issuedAt.getTime() + AUTHENTICATION_POLICY.lifetimes.authorizationSnapshotMs),
  );
}

function scopeKey(row: AuthorizationProjectionRow): string {
  return `${row.companyId ?? ""}|${row.branchId ?? ""}`;
}

/** Del ámbito más amplio al más concreto: comercio, empresa, sucursal. */
function compareScopes(
  left: { companyId: string | null; branchId: string | null },
  right: { companyId: string | null; branchId: string | null },
): number {
  const rank = (value: { companyId: string | null; branchId: string | null }): number =>
    value.companyId === null ? 0 : value.branchId === null ? 1 : 2;
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  const leftKey = `${left.companyId ?? ""}|${left.branchId ?? ""}`;
  const rightKey = `${right.companyId ?? ""}|${right.branchId ?? ""}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

/**
 * Filas → asignaciones del SAS, una por ámbito (el contrato prohíbe repetir
 * ámbito). Si dos roles coinciden en el mismo ámbito se unen:
 *
 * - los permisos se suman; si un código llega `ACTIVE` por un rol y `RETIRED`
 *   por otro, gana `ACTIVE` —lo concede el primero—;
 * - la vigencia es la **intersección** (el `valid_from` más tardío y el
 *   `valid_until` más temprano): nunca se concede un permiso fuera de la
 *   vigencia de alguno de los roles que lo aportan. Todas las filas son
 *   vigentes en el instante del login, así que la intersección lo contiene.
 *
 * Salida ordenada —del ámbito más amplio al más concreto, y por código dentro
 * de cada uno—: el mismo estado central produce los mismos bytes firmados.
 */
export function projectAssignments(tenantId: string, rows: readonly AuthorizationProjectionRow[]): SnapshotAssignment[] {
  const byScope = new Map<string, {
    companyId: string | null; branchId: string | null; validFrom: number; validUntil: number | null;
    permissions: Map<string, "ACTIVE" | "RETIRED">;
  }>();
  for (const row of rows) {
    const key = scopeKey(row);
    const current = byScope.get(key);
    const until = row.validUntil === null ? null : row.validUntil.getTime();
    const entry = current ?? {
      companyId: row.companyId, branchId: row.branchId,
      validFrom: row.validFrom.getTime(), validUntil: until, permissions: new Map(),
    };
    entry.validFrom = Math.max(entry.validFrom, row.validFrom.getTime());
    if (until !== null) entry.validUntil = entry.validUntil === null ? until : Math.min(entry.validUntil, until);
    if (row.permissionCode !== null && row.permissionStatus !== null) {
      const previous = entry.permissions.get(row.permissionCode);
      entry.permissions.set(row.permissionCode, previous === "ACTIVE" ? "ACTIVE" : row.permissionStatus);
    }
    byScope.set(key, entry);
  }
  return [...byScope.values()]
    .sort(compareScopes)
    .map((entry) => ({
      tenant_id: tenantId,
      company_id: entry.companyId,
      branch_id: entry.branchId,
      status: "ACTIVE" as const,
      valid_from: new Date(entry.validFrom).toISOString(),
      valid_until: entry.validUntil === null ? null : new Date(entry.validUntil).toISOString(),
      role_status: "ACTIVE" as const,
      permissions: [...entry.permissions.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([code, status]) => ({ code, status })),
    }));
}

export class OperatorSessionIssuer {
  constructor(
    private readonly sessionAssertionKey: SessionTrustSigningKey,
    private readonly authorizationSnapshotKey: SessionTrustSigningKey,
  ) {
    if (sessionAssertionKey.keyId === authorizationSnapshotKey.keyId) {
      throw new Error("session assertion and authorization snapshot must be signed with distinct keys");
    }
  }

  issue(input: OperatorSessionIssueInput): OperatorSessionProvisioningArtifact {
    const issuedAt = input.issuedAt.toISOString();
    const expiresAt = authorizationSnapshotExpiresAt(input.issuedAt, input.sessionExpiresAt).toISOString();

    const snapshotClaims = AuthorizationSnapshotClaimsSchema.parse({
      snapshot_id: uuidV7(input.issuedAt.getTime()),
      user_id: input.userId,
      installation_id: input.installationId,
      device_id: input.deviceId,
      sequence: input.sequence,
      issued_at: issuedAt,
      expires_at: expiresAt,
      assignments: projectAssignments(input.tenantId, input.projection),
      key_id: this.authorizationSnapshotKey.keyId,
    });
    const assertionClaims = SessionAssertionClaimsSchema.parse({
      session_id: input.sessionId,
      user_id: input.userId,
      tenant_membership_id: input.membershipId,
      installation_id: input.installationId,
      device_id: input.deviceId,
      issued_at: issuedAt,
      // La SSA no puede sobrevivir a los permisos que la acompañan (`DEC-012` §19).
      offline_valid_until: expiresAt,
      sequence: input.sequence,
      key_id: this.sessionAssertionKey.keyId,
    });

    return OperatorSessionProvisioningArtifactSchema.parse({
      version: 1,
      session_assertion: {
        claims: assertionClaims,
        signature: sign(null, Buffer.from(canonicalSessionTrustJson(assertionClaims)), this.sessionAssertionKey.privateKey).toString("base64url"),
      },
      authorization_snapshot: {
        claims: snapshotClaims,
        signature: sign(null, Buffer.from(canonicalSessionTrustJson(snapshotClaims)), this.authorizationSnapshotKey.privateKey).toString("base64url"),
      },
    });
  }
}
