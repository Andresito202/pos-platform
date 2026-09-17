import { verify } from "node:crypto";
import {
  SessionAssertionClaimsSchema,
  SignedSessionAssertionSchema,
  type SessionAssertionClaims,
  type SignedSessionAssertion,
} from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { TrustedClockGuard } from "./trusted-clock.js";
import type { TrustedSigningKey } from "./license-verifier.js";

/**
 * Verificador de la Signed Session Assertion (SSA-002, `DEC-012`).
 *
 * Reutiliza íntegramente la maquinaria de SAS-001: Ed25519 vía `node:crypto`
 * sobre `canonicalJson(claims)`, el mismo mapa de `TrustedSigningKey` con sus
 * tres estados, y `TrustedClockGuard`. No introduce un tercer mecanismo
 * criptográfico ni una segunda canonicalización.
 *
 * **Su resultado afirma identidad, nunca autorización.** Un `VALID` significa
 * «esta SSA está firmada por una clave de confianza, dentro de su ventana, con
 * el binding esperado y con una secuencia no reproducida». No significa que el
 * usuario pueda hacer nada: eso lo decide `evaluatePermission()` sobre el
 * snapshot de autorización, y este módulo no lo importa ni lo invoca.
 *
 * No persiste nada. La comparación de `sequence` es contra una cota que el
 * llamador proporciona; el estado persistido y su actualización pertenecen al
 * bloque de persistencia posterior.
 */

export type SessionAssertionDecision =
  | "VALID"
  | "SIGNATURE_INVALID"
  | "SIGNING_KEY_REVOKED"
  | "BINDING_MISMATCH"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "SEQUENCE_REPLAY";

export interface SessionAssertionBinding {
  readonly userId: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface SessionAssertionVerificationOptions {
  readonly highestAcceptedSequence?: number;
}

export interface SessionAssertionVerificationResult {
  readonly decision: SessionAssertionDecision;
  readonly claims: SessionAssertionClaims | null;
  readonly evaluatedAt: string;
}

function assertExpectedBinding(binding: SessionAssertionBinding): void {
  for (const [field, value] of Object.entries(binding)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`expected session binding requires ${field}`);
    }
  }
}

export class SessionAssertionVerifier {
  constructor(
    private readonly keys: ReadonlyMap<string, TrustedSigningKey>,
    private readonly trustedClock: TrustedClockGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(
    input: unknown,
    binding: SessionAssertionBinding,
    options: SessionAssertionVerificationOptions = {},
  ): SessionAssertionVerificationResult {
    assertExpectedBinding(binding);

    const evaluatedAt = this.now();
    this.trustedClock.accept(evaluatedAt);
    const at = evaluatedAt.toISOString();

    const signed = SignedSessionAssertionSchema.parse(input);
    const claims = SessionAssertionClaimsSchema.parse(signed.claims);

    const trustedKey = this.keys.get(claims.key_id);
    if (!trustedKey) return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: at };

    if (trustedKey.status === "REVOKED") {
      return { decision: "SIGNING_KEY_REVOKED", claims: null, evaluatedAt: at };
    }

    // The operational key lifecycle is itself trusted material. Enforce its
    // window on every SSA verification, not only at bootstrap, so an in-memory
    // key cannot outlive its signed trust window.
    const time = evaluatedAt.getTime();
    if (trustedKey.validFrom !== undefined && time < Date.parse(trustedKey.validFrom)) {
      return { decision: "NOT_YET_VALID", claims: null, evaluatedAt: at };
    }
    if (trustedKey.validUntil !== undefined && trustedKey.validUntil !== null && time >= Date.parse(trustedKey.validUntil)) {
      return { decision: "EXPIRED", claims: null, evaluatedAt: at };
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
    if (!valid) return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: at };

    if (
      claims.user_id !== binding.userId
      || claims.installation_id !== binding.installationId
      || claims.device_id !== binding.deviceId
    ) {
      return { decision: "BINDING_MISMATCH", claims, evaluatedAt: at };
    }

    if (time < Date.parse(claims.issued_at)) {
      return { decision: "NOT_YET_VALID", claims, evaluatedAt: at };
    }
    if (time >= Date.parse(claims.offline_valid_until)) {
      return { decision: "EXPIRED", claims, evaluatedAt: at };
    }

    const baseline = options.highestAcceptedSequence;
    if (baseline !== undefined && claims.sequence <= baseline) {
      return { decision: "SEQUENCE_REPLAY", claims, evaluatedAt: at };
    }

    return { decision: "VALID", claims, evaluatedAt: at };
  }
}

export function unsignedSessionAssertionBytes(claims: SessionAssertionClaims): Buffer {
  return Buffer.from(canonicalJson(SessionAssertionClaimsSchema.parse(claims)));
}

export type { SignedSessionAssertion };
