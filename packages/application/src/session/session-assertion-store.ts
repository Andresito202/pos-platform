import type {
  SessionAssertionClaims,
  SignedSessionAssertion,
} from "@pos-platform/contracts";

/**
 * Puerto de persistencia de la Signed Session Assertion (SSA-003, `DEC-012`).
 *
 * Define el contrato sin nombrar SQLite, Kysely ni better-sqlite3, de modo que
 * el almacenamiento concreto pueda sustituirse sin tocar a sus consumidores.
 *
 * Vive en `application` y no en el runtime porque `DEC-012` sitúa aquí al
 * futuro resolutor que traduce SSA + SAS a un actor y un ámbito: ese consumidor
 * necesitará cargar el estado de sesión y no puede depender del adaptador
 * concreto. El puerto se declara donde estará su consumidor, no donde está hoy
 * su única implementación.
 *
 * Este puerto **no decide identidad ni autorización**. Persistir no confiere
 * autoridad: la verificación criptográfica pertenece a SSA-002 y la
 * autorización, en exclusiva, al snapshot de autorización.
 */

export interface SessionBinding {
  readonly userId: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface StoredSessionAssertion {
  readonly claims: SessionAssertionClaims;
  readonly signature: string;
  readonly activatedAt: string;
}

/**
 * `STALE_SEQUENCE` cubre tanto una secuencia menor como una igual: solo una
 * estrictamente mayor puede desplazar a la sesión activa, de modo que reenviar
 * la SSA vigente nunca cuenta como una activación nueva.
 */
export type SessionActivationOutcome =
  | { readonly kind: "ACTIVATED"; readonly sequence: number }
  | { readonly kind: "STALE_SEQUENCE"; readonly currentSequence: number }
  | { readonly kind: "BINDING_MISMATCH" };

export interface SessionAssertionStore {
  /**
   * Activa una SSA **ya verificada criptográficamente**. Este puerto no
   * verifica firmas: esa es responsabilidad de `SessionAssertionVerifier`
   * (SSA-002).
   *
   * La comparación de secuencia debe ocurrir dentro de la misma transacción
   * que la escritura, para que dos activaciones concurrentes no puedan leer la
   * misma secuencia actual y considerarse ambas mayores.
   */
  activate(
    signed: SignedSessionAssertion,
    binding: SessionBinding,
  ): SessionActivationOutcome;

  /**
   * Devuelve la sesión del binding únicamente si está dentro de su ventana
   * temporal. Una SSA expirada no constituye sesión activa y se comunica como
   * ausencia, no como advertencia: no existe gracia offline.
   */
  loadActive(binding: SessionBinding): StoredSessionAssertion | null;

  /**
   * Cota superior aceptada para el binding, con independencia de que la SSA
   * correspondiente siga vigente. Es el origen durable del baseline anti-replay
   * que SSA-002 recibía como parámetro: una fila expirada sigue contando aquí,
   * y por eso una SSA antigua no puede reentrar tras vencer la actual.
   *
   * `null` significa «este binding no ha aceptado ninguna SSA todavía», no
   * «cualquier secuencia es válida».
   */
  highestAcceptedSequence(binding: SessionBinding): number | null;
}
