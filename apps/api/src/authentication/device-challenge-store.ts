import { randomBytes, randomUUID } from "node:crypto";
import type { DeviceTrustChallenge } from "@pos-platform/contracts";

/**
 * Desafíos de prueba de equipo, en memoria.
 *
 * **Decisión tomada aquí, no pedida al propietario, y registrada como tal**
 * (`DEC-026` §13, brecha de diseño abierta desde que se escribió el motor de
 * login): un desafío usado no debe poder reutilizarse aunque haya varios
 * servidores o uno se reinicie, y una tabla en PostgreSQL lo garantizaría
 * mejor que memoria de proceso. Se elige memoria porque hoy hay **un solo**
 * proceso de `apps/api` y ninguna alta disponibilidad que lo contradiga
 * (`docs/governance/stack-conformance-audit.md`); si eso cambia, esta clase
 * se sustituye por una tabla —el contrato (`issue`/`consume`) no cambiaría—.
 * Limitación aceptada y explícita: un reinicio del proceso invalida los
 * desafíos pendientes (el cliente simplemente pide uno nuevo) y dos réplicas
 * del proceso no compartirían desafíos entre sí.
 */
const CHALLENGE_TTL_MS = 2 * 60_000;
const MAX_PENDING_CHALLENGES = 10_000;

export class DeviceChallengeStore {
  private readonly pending = new Map<string, DeviceTrustChallenge>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  issue(binding: { readonly tenantId: string; readonly installationId: string; readonly deviceId: string }): DeviceTrustChallenge {
    this.evictExpired();
    if (this.pending.size >= MAX_PENDING_CHALLENGES) {
      // Un atacante sin credencial válida no puede llegar más lejos que
      // pedir desafíos; agotar memoria con ellos no debe ser gratis.
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    const at = this.now();
    const challenge: DeviceTrustChallenge = {
      challenge_id: randomUUID(),
      tenant_id: binding.tenantId,
      installation_id: binding.installationId,
      device_id: binding.deviceId,
      nonce: randomBytes(32).toString("base64url"),
      issued_at: at.toISOString(),
      expires_at: new Date(at.getTime() + CHALLENGE_TTL_MS).toISOString(),
    };
    this.pending.set(challenge.challenge_id, challenge);
    return challenge;
  }

  /** Un solo uso: consumir borra el desafío, exista o no, antes de devolverlo. */
  consume(challengeId: string): DeviceTrustChallenge | null {
    const challenge = this.pending.get(challengeId) ?? null;
    this.pending.delete(challengeId);
    if (challenge === null) return null;
    return Date.parse(challenge.expires_at) > this.now().getTime() ? challenge : null;
  }

  private evictExpired(): void {
    const now = this.now().getTime();
    for (const [id, challenge] of this.pending) {
      if (Date.parse(challenge.expires_at) <= now) this.pending.delete(id);
    }
  }
}
