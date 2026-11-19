import { verify } from "node:crypto";
import {
  MasterSnapshotClaimsSchema,
  SignedMasterSnapshotSchema,
  type MasterSnapshotClaims,
  type MasterSnapshotEnvironment,
} from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { TrustedClockGuard } from "./trusted-clock.js";
import type { TrustedSigningKey } from "./license-verifier.js";

/**
 * Verificador de snapshots firmados de datos maestros (`DEC-013` §5, §13).
 *
 * Reutiliza íntegramente la maquinaria ya probada: Ed25519 vía `node:crypto`
 * sobre `canonicalJson(claims)`, los tres estados de `TrustedSigningKey` y
 * `TrustedClockGuard`. No introduce criptografía nueva ni una segunda
 * canonicalización.
 *
 * **No persiste nada.** La comparación de coordenada es contra una cota que el
 * llamador proporciona; escribir la proyección y avanzar la cota pertenecen a
 * la activación, que ocurre en una única transacción posterior.
 *
 * El propósito de clave se comprueba aquí porque `DEC-013` §4 exige que una
 * clave de licencias, de actualizaciones o de confianza de dispositivo no pueda
 * firmar un snapshot maestro. Por eso el mapa que recibe este verificador es
 * propio y lleva `purpose`: no se amplía `TrustedSigningKey`, que sirve a otros
 * artefactos con otras clases de clave.
 */

export const MASTER_SNAPSHOT_KEY_PURPOSE = "MASTER_SNAPSHOT" as const;

export interface MasterSnapshotSigningKey extends TrustedSigningKey {
  readonly purpose: string;
}

export type MasterSnapshotDecision =
  | "VALID"
  | "INVALID_SCHEMA"
  | "INVALID_SIGNATURE"
  | "UNKNOWN_KEY"
  | "WRONG_KEY_PURPOSE"
  | "REVOKED_KEY"
  | "WRONG_ENVIRONMENT"
  | "WRONG_SCOPE"
  | "OBSOLETE_SEQUENCE"
  | "DUPLICATE_SEQUENCE";

export interface MasterSnapshotScope {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly environment: MasterSnapshotEnvironment;
}

export interface MasterSnapshotVerificationOptions {
  /**
   * Cota efectiva ya aceptada para este ámbito, en el sentido de
   * `DEC-013` §27: `max(accepted local, acknowledged floor central)`. Sólo una
   * coordenada estrictamente mayor es candidata.
   *
   * Omitirla significa «sin cota conocida», no «cualquier coordenada sirve»: el
   * llamador que dispone de estado persistido debe pasarla siempre.
   */
  readonly effectiveFloor?: number;
}

export interface MasterSnapshotVerificationResult {
  readonly decision: MasterSnapshotDecision;
  /** Nulo mientras la firma no esté probada: unos claims sin firma no son evidencia de nada. */
  readonly claims: MasterSnapshotClaims | null;
  readonly evaluatedAt: string;
}

function assertExpectedScope(scope: MasterSnapshotScope): void {
  // El ámbito esperado es contexto del propio llamador. Un contexto incompleto
  // es un error de cableado, y aceptarlo convertiría una comparación vacía en
  // un ámbito válido.
  for (const [field, value] of Object.entries(scope)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`expected master snapshot scope requires ${field}`);
    }
  }
}

export class MasterSnapshotVerifier {
  constructor(
    private readonly keys: ReadonlyMap<string, MasterSnapshotSigningKey>,
    private readonly trustedClock: TrustedClockGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(
    input: unknown,
    scope: MasterSnapshotScope,
    options: MasterSnapshotVerificationOptions = {},
  ): MasterSnapshotVerificationResult {
    assertExpectedScope(scope);

    const evaluatedAt = this.now();
    // Primero el reloj, igual que en SAS-001 y SSA-002: un reloj retrocedido no
    // debe poder alterar ninguna evaluación posterior.
    this.trustedClock.accept(evaluatedAt);
    const at = evaluatedAt.toISOString();

    // Un tipo no autorizado, un campo inesperado o un payload fuera de ámbito
    // fallan aquí, antes de tocar clave o firma. `CATALOG`, `PRICING` y `TAX`
    // caen en esta rama por el literal del contrato.
    let signed: ReturnType<typeof SignedMasterSnapshotSchema.parse>;
    try {
      signed = SignedMasterSnapshotSchema.parse(input);
    } catch {
      return { decision: "INVALID_SCHEMA", claims: null, evaluatedAt: at };
    }

    // Se canonicaliza el resultado del parseo, no la entrada cruda, para que
    // los bytes firmados y los verificados sean necesariamente los mismos.
    const claims = MasterSnapshotClaimsSchema.parse(signed.claims);

    const trustedKey = this.keys.get(claims.key_id);
    if (!trustedKey) return { decision: "UNKNOWN_KEY", claims: null, evaluatedAt: at };

    // `DEC-013` §4: comprometer una clave no debe permitir firmar toda clase de
    // artefacto. Se comprueba antes que la firma para que una clave de otra
    // clase no llegue siquiera a intentar verificar.
    if (trustedKey.purpose !== MASTER_SNAPSHOT_KEY_PURPOSE) {
      return { decision: "WRONG_KEY_PURPOSE", claims: null, evaluatedAt: at };
    }

    // `VERIFY_ONLY` sigue verificando: es lo que permite rotar sin ventana de
    // corte. Sólo `REVOKED` corta la confianza.
    if (trustedKey.status === "REVOKED") {
      return { decision: "REVOKED_KEY", claims: null, evaluatedAt: at };
    }

    let valid: boolean;
    try {
      valid = verify(
        null,
        Buffer.from(canonicalJson(claims)),
        trustedKey.key,
        Buffer.from(signed.signature, "base64url"),
      );
    } catch {
      valid = false;
    }
    if (!valid) return { decision: "INVALID_SIGNATURE", claims: null, evaluatedAt: at };

    // Desde aquí la firma está probada y devolver claims es legítimo. Ambiente y
    // ámbito se comparan sobre claims autenticados, nunca sobre datos que el
    // portador de la petición pudiera elegir: ése es el motivo del orden.
    if (claims.environment !== scope.environment) {
      return { decision: "WRONG_ENVIRONMENT", claims, evaluatedAt: at };
    }

    if (
      claims.tenant_id !== scope.tenantId
      || claims.company_id !== scope.companyId
      || claims.branch_id !== scope.branchId
    ) {
      return { decision: "WRONG_SCOPE", claims, evaluatedAt: at };
    }

    // Anti-replay. Estrictamente mayor: una coordenada igual es un reenvío y una
    // menor es obsoleta; ninguna desplaza a la proyección activa.
    const floor = options.effectiveFloor;
    if (floor !== undefined) {
      if (claims.sequence === floor) {
        return { decision: "DUPLICATE_SEQUENCE", claims, evaluatedAt: at };
      }
      if (claims.sequence < floor) {
        return { decision: "OBSOLETE_SEQUENCE", claims, evaluatedAt: at };
      }
    }

    return { decision: "VALID", claims, evaluatedAt: at };
  }
}

/**
 * Bytes exactos cubiertos por la firma. El emisor debe firmar esto y nada más;
 * los tests lo usan para producir firmas con material criptográfico de prueba.
 */
export function unsignedMasterSnapshotBytes(claims: MasterSnapshotClaims): Buffer {
  return Buffer.from(canonicalJson(MasterSnapshotClaimsSchema.parse(claims)));
}
