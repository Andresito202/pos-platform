import {
  SignedSessionAssertionSchema,
  type SignedSessionAssertion,
} from "@pos-platform/contracts";
import type {
  SessionAssertionStore,
  SessionBinding,
  StoredSessionAssertion,
} from "@pos-platform/application";
import type {
  SessionAssertionDecision,
  SessionAssertionVerifier,
} from "../security/session-assertion-verifier.js";

/**
 * Activación y recuperación de la sesión local (SSA-003, `DEC-012`).
 *
 * Única ruta canónica que puede activar una sesión:
 *
 *   entrada → SessionAssertionVerifier (SSA-002) → SessionAssertionStore (SSA-003)
 *
 * El store no verifica firmas y este servicio no escribe SQL: separando ambas
 * responsabilidades, ninguna ruta puede persistir una SSA que no haya superado
 * la verificación criptográfica.
 *
 * **Resuelve el pendiente que dejó SSA-002.** Allí `highestAcceptedSequence`
 * era un parámetro del llamador; aquí lo aporta el estado persistido del
 * binding, de modo que en producción no depende de un valor arbitrario. La
 * comparación definitiva vuelve a hacerse dentro de la transacción de
 * activación: el baseline es una comprobación temprana, no la autoridad.
 *
 * Afirma identidad de sesión, nunca autorización. No importa ni invoca el motor
 * de permisos.
 */

export type SessionActivationResult =
  | { readonly kind: "ACTIVATED"; readonly sequence: number }
  | { readonly kind: "REJECTED"; readonly decision: SessionAssertionDecision }
  | { readonly kind: "STALE_SEQUENCE"; readonly currentSequence: number }
  | { readonly kind: "BINDING_MISMATCH" };

export type SessionRecoveryResult =
  | { readonly kind: "ACTIVE"; readonly session: StoredSessionAssertion }
  | { readonly kind: "NONE" }
  | { readonly kind: "UNVERIFIABLE"; readonly decision: SessionAssertionDecision };

export class SessionActivationService {
  constructor(
    private readonly verifier: SessionAssertionVerifier,
    private readonly store: SessionAssertionStore,
  ) {}

  activate(input: unknown, binding: SessionBinding): SessionActivationResult {
    // Estructura primero: una entrada malformada nunca llega al verificador ni
    // al store.
    const signed: SignedSessionAssertion = SignedSessionAssertionSchema.parse(input);

    const baseline = this.store.highestAcceptedSequence(binding);
    const result = this.verifier.verify(
      signed,
      binding,
      baseline === null ? {} : { highestAcceptedSequence: baseline },
    );
    if (result.decision !== "VALID") {
      return { kind: "REJECTED", decision: result.decision };
    }

    // Si el store lanza (p. ej. fallo de I/O), se propaga: el rollback
    // transaccional garantiza que la sesión anterior queda intacta.
    const activation = this.store.activate(signed, binding);
    if (activation.kind === "ACTIVATED") {
      return { kind: "ACTIVATED", sequence: activation.sequence };
    }
    return activation;
  }

  /**
   * Recupera la sesión persistida tras un reinicio. No es un login: no
   * autentica a nadie, solo determina si una SSA previamente aceptada sigue
   * siendo utilizable.
   *
   * Re-verifica criptográficamente lo recuperado, porque el store conserva
   * firma y claims pero no es autoridad criptográfica. Una SSA expirada nunca
   * vuelve a estar activa, y su secuencia permanece como cota anti-replay.
   */
  recover(binding: SessionBinding): SessionRecoveryResult {
    const stored = this.store.loadActive(binding);
    if (stored === null) return { kind: "NONE" };

    const baseline = this.store.highestAcceptedSequence(binding);
    const result = this.verifier.verify(
      { claims: stored.claims, signature: stored.signature },
      binding,
      // La sesión recuperada es exactamente la que fijó la cota, así que
      // compararla contra sí misma la marcaría como replay. El anti-replay
      // aplica a SSA entrantes, no a la ya activa.
      baseline === null ? {} : { highestAcceptedSequence: baseline - 1 },
    );
    if (result.decision !== "VALID") {
      return { kind: "UNVERIFIABLE", decision: result.decision };
    }
    return { kind: "ACTIVE", session: stored };
  }
}
