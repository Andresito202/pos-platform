import { verify } from "node:crypto";
import {
  AuthorizationSnapshotClaimsSchema,
  SignedAuthorizationSnapshotSchema,
  type AuthorizationSnapshotClaims,
  type SignedAuthorizationSnapshot,
} from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { TrustedClockGuard } from "./trusted-clock.js";
import type { TrustedSigningKey } from "./license-verifier.js";

/**
 * Verificador del Signed Authorization Snapshot (DEC-011).
 *
 * Reutiliza la misma maquinaria que `LicenseVerifier`: Ed25519 vía `node:crypto`
 * sobre `canonicalJson(claims)`, claves con estado y `TrustedClockGuard`. No
 * introduce un segundo mecanismo criptográfico.
 *
 * Su responsabilidad termina en producir un snapshot verificado. La proyección
 * a `RoleAssignment[]`, la persistencia y la regla de aceptación de `sequence`
 * pertenecen a bloques posteriores.
 */

export type AuthorizationSnapshotDecision =
  | "VALID"
  | "SIGNATURE_INVALID"
  | "SIGNING_KEY_REVOKED"
  | "BINDING_MISMATCH"
  | "NOT_YET_VALID"
  | "EXPIRED";

export interface AuthorizationSnapshotBinding {
  readonly installationId: string;
  readonly deviceId: string;
  readonly userId: string;
}

export interface AuthorizationSnapshotVerificationResult {
  readonly decision: AuthorizationSnapshotDecision;
  /**
   * Nulo mientras la firma no esté probada. Devolver claims no verificados
   * invitaría a consumirlos, y un snapshot sin firma válida no es evidencia
   * de nada.
   */
  readonly claims: AuthorizationSnapshotClaims | null;
  readonly evaluatedAt: string;
}

export class AuthorizationSnapshotVerifier {
  constructor(
    private readonly keys: ReadonlyMap<string, TrustedSigningKey>,
    private readonly trustedClock: TrustedClockGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(
    input: unknown,
    binding: AuthorizationSnapshotBinding,
  ): AuthorizationSnapshotVerificationResult {
    const evaluatedAt = this.now();
    // Antes que nada: un reloj retrocedido podría revivir un snapshot expirado.
    this.trustedClock.accept(evaluatedAt);
    const at = evaluatedAt.toISOString();

    const signed = SignedAuthorizationSnapshotSchema.parse(input);
    // Se canonicaliza el resultado del parseo, no la entrada cruda, para que
    // los bytes firmados y los verificados sean necesariamente los mismos.
    const claims = AuthorizationSnapshotClaimsSchema.parse(signed.claims);

    const trustedKey = this.keys.get(claims.key_id);
    // Una clave desconocida se reporta como firma inválida y no como una causa
    // propia: distinguirlas revelaría qué identificadores de clave existen.
    if (!trustedKey) return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: at };

    // `VERIFY_ONLY` sigue verificando: es el estado que permite rotar sin una
    // ventana de corte. Sólo `REVOKED` corta la confianza.
    if (trustedKey.status === "REVOKED") {
      return { decision: "SIGNING_KEY_REVOKED", claims: null, evaluatedAt: at };
    }
    if((trustedKey.validFrom&&(!Number.isFinite(Date.parse(trustedKey.validFrom))||evaluatedAt.getTime()<Date.parse(trustedKey.validFrom)))||
      (trustedKey.validUntil&&(!Number.isFinite(Date.parse(trustedKey.validUntil))||evaluatedAt.getTime()>=Date.parse(trustedKey.validUntil))))
      return {decision:"SIGNING_KEY_REVOKED",claims:null,evaluatedAt:at};

    const valid = verify(
      null,
      Buffer.from(canonicalJson(claims)),
      trustedKey.key,
      Buffer.from(signed.signature, "base64url"),
    );
    if (!valid) return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: at };

    // A partir de aquí la firma está probada y devolver claims es legítimo.
    if (
      claims.installation_id !== binding.installationId
      || claims.device_id !== binding.deviceId
      || claims.user_id !== binding.userId
    ) {
      return { decision: "BINDING_MISMATCH", claims, evaluatedAt: at };
    }

    const time = evaluatedAt.getTime();
    if (time < Date.parse(claims.issued_at)) {
      return { decision: "NOT_YET_VALID", claims, evaluatedAt: at };
    }
    // Vigencia semiabierta [issued_at, expires_at), coherente con la vigencia
    // de las asignaciones en el dominio: en el instante exacto de expiración el
    // snapshot ya no autoriza.
    if (time >= Date.parse(claims.expires_at)) {
      return { decision: "EXPIRED", claims, evaluatedAt: at };
    }

    return { decision: "VALID", claims, evaluatedAt: at };
  }
}

/**
 * Bytes exactos cubiertos por la firma. El emisor debe firmar esto y nada más;
 * los tests lo usan para producir firmas con material criptográfico de prueba.
 */
export function unsignedAuthorizationSnapshotBytes(claims: AuthorizationSnapshotClaims): Buffer {
  return Buffer.from(canonicalJson(AuthorizationSnapshotClaimsSchema.parse(claims)));
}

export type { SignedAuthorizationSnapshot };
