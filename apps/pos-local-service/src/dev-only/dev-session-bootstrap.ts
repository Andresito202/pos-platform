import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SqliteTrustAnchorStore } from "../security/sqlite-trust-anchor-store.js";
import type { SessionActivationService } from "../session/session-activation.js";
import type { SqliteAuthorizationSnapshotStore } from "../authorization/sqlite-authorization-snapshot-store.js";
import { AuthorizationSnapshotVerifier } from "../security/authorization-snapshot-verifier.js";
import type { TrustedClockGuard } from "../security/trusted-clock.js";
import { DEV_ROLE_PRESETS, type DevRolePresetId } from "./dev-role-presets.js";

const SESSION_KEY_ID = "DEV-LOCAL-SSA";
const SNAPSHOT_KEY_ID = "DEV-LOCAL-SAS";

/**
 * UUIDs fijos, uno por rol, para que el operador de cada preset sea
 * reconocible en el log y no cambie entre arranques. Exportado para que las
 * pruebas puedan consultar el snapshot activado sin adivinar ni duplicar el
 * literal.
 */
export const PRESET_USER_ID: Readonly<Record<DevRolePresetId, string>> = {
  ADMIN: "00000000-0000-7000-8000-00000000a001",
  SUPERVISOR: "00000000-0000-7000-8000-00000000a002",
  CAJERO: "00000000-0000-7000-8000-00000000a003",
};
const DEV_TENANT_ID = "00000000-0000-7000-8000-0000000000d1";
const DEV_SESSION_ID = "00000000-0000-7000-8000-0000000000d2";
const DEV_SNAPSHOT_ID = "00000000-0000-7000-8000-0000000000d3";
const DEV_TENANT_MEMBERSHIP_ID = "00000000-0000-7000-8000-0000000000d4";

/** Vigencia corta a propósito: es una sesión de revisión de pantallas, no un turno real. */
const DEV_SESSION_VALID_HOURS = 4;

export interface DevSessionBinding {
  /**
   * Sólo el equipo. El usuario **no** se recibe: cada preset tiene un
   * `user_id` fijo propio (`PRESET_USER_ID`), precisamente para que no se
   * pueda activar un preset a nombre de un usuario arbitrario que el llamador
   * decida pasar.
   */
  readonly installationId: string;
  readonly deviceId: string;
}

export type DevSessionBootstrapOutcome =
  | { readonly kind: "PROVISIONED"; readonly preset: DevRolePresetId }
  | { readonly kind: "SESSION_REJECTED"; readonly detail: unknown }
  | { readonly kind: "SNAPSHOT_REJECTED"; readonly detail: unknown };

/**
 * Las claves efímeras, ya provisionadas en el ancla, retenidas sólo para
 * firmar más tarde. Nunca se persisten y nunca salen de memoria de proceso.
 */
export interface DevRoleTrustMaterial {
  readonly sessionPrivateKey: KeyObject;
  readonly snapshotPrivateKey: KeyObject;
}

function ed25519KeyPair(): { readonly privateKey: KeyObject; readonly publicKeySpkiBase64Url: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKeySpkiBase64Url: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function signClaims<T extends object>(claims: T, privateKey: KeyObject): { claims: T; signature: string } {
  return { claims, signature: sign(null, Buffer.from(canonicalJson(claims)), privateKey).toString("base64url") };
}

/**
 * Provisiona el ancla efímera de la sesión de revisión por rol.
 *
 * **Tiene que ejecutarse antes de que `CommercialComponent.start()` resuelva
 * su mapa de claves.** Ese componente lo resuelve una sola vez, dentro de su
 * propio `start()` (`DEC-011`: rotar exige reiniciar) — es el mismo defecto de
 * orden de arranque que ya midió y corrigió `main.ts` para el artefacto real
 * de `DEC-025` (ver el comentario de `sessionTrustProvisioning` ahí). Provisionar
 * después de que `commercial` arrancó dejaría su verificador con el mapa vacío
 * de antes, y `session.activate` rechazaría la SSA con `SIGNATURE_INVALID` sin
 * que nada en este módulo lo explicara.
 *
 * Por eso este módulo separa provisión de activación: `main.ts` llama a esta
 * función desde un componente que arranca **entre** `security` y `commercial`
 * en la lista de componentes, y llama a `activateDevRoleSession` **después**
 * de `lifecycle.start()`, con el material que esta función retuvo.
 */
export function provisionDevRoleTrustAnchors(trustAnchors: SqliteTrustAnchorStore): DevRoleTrustMaterial {
  const sessionKeys = ed25519KeyPair();
  const snapshotKeys = ed25519KeyPair();

  trustAnchors.provision({
    purpose: "SESSION_ASSERTION", keyId: SESSION_KEY_ID,
    publicKeySpki: sessionKeys.publicKeySpkiBase64Url, status: "ACTIVE",
  });
  trustAnchors.provision({
    purpose: "AUTHORIZATION_SNAPSHOT", keyId: SNAPSHOT_KEY_ID,
    publicKeySpki: snapshotKeys.publicKeySpkiBase64Url, status: "ACTIVE",
  });

  return { sessionPrivateKey: sessionKeys.privateKey, snapshotPrivateKey: snapshotKeys.privateKey };
}

/**
 * Activación de una sesión de **revisión de pantallas por rol**, no de
 * producción — ver la cabecera de `dev-role-presets.ts` para qué decide y qué
 * no decide esto.
 *
 * ## Por qué reutiliza la ruta canónica y no inventa una segunda
 *
 * Firma una SSA y un SAS sintéticos con la clave efímera que
 * `provisionDevRoleTrustAnchors` ya dejó en el ancla, y pasa por
 * **exactamente** `SessionActivationService.activate` y
 * `AuthorizationSnapshotVerifier.verify` + `authorizationStore.activate`: las
 * mismas rutas que verifica una sesión real. No hay atajo que salte la
 * verificación de firma; lo único distinto de un equipo real es quién firmó.
 */
export function activateDevRoleSession(
  preset: DevRolePresetId,
  binding: DevSessionBinding,
  material: DevRoleTrustMaterial,
  trustAnchors: SqliteTrustAnchorStore,
  sessionActivation: SessionActivationService,
  authorizationStore: SqliteAuthorizationSnapshotStore,
  trustedClock: TrustedClockGuard,
  now: () => Date = () => new Date(),
): DevSessionBootstrapOutcome {
  const at = now();
  const sessionKeys = { privateKey: material.sessionPrivateKey };
  const snapshotKeys = { privateKey: material.snapshotPrivateKey };

  const issuedAt = at.toISOString();
  const offlineValidUntil = new Date(at.getTime() + DEV_SESSION_VALID_HOURS * 60 * 60 * 1000).toISOString();

  const signedSsa = signClaims({
    session_id: DEV_SESSION_ID,
    user_id: PRESET_USER_ID[preset],
    tenant_membership_id: DEV_TENANT_MEMBERSHIP_ID,
    installation_id: binding.installationId,
    device_id: binding.deviceId,
    issued_at: issuedAt,
    offline_valid_until: offlineValidUntil,
    sequence: 1,
    key_id: SESSION_KEY_ID,
  }, sessionKeys.privateKey);

  const activation = sessionActivation.activate(signedSsa, {
    userId: PRESET_USER_ID[preset], installationId: binding.installationId, deviceId: binding.deviceId,
  });
  if (activation.kind !== "ACTIVATED") return { kind: "SESSION_REJECTED", detail: activation };

  // El snapshot no puede expirar antes que la sesión: es la misma invariante
  // que exige el artefacto real de `DEC-025` (`DEC-012` §Fronteras SSA vs SAS).
  const expiresAt = new Date(
    Math.max(Date.parse(offlineValidUntil), at.getTime()) + 60 * 60 * 1000,
  ).toISOString();

  const signedSas = signClaims({
    snapshot_id: DEV_SNAPSHOT_ID,
    user_id: PRESET_USER_ID[preset],
    installation_id: binding.installationId,
    device_id: binding.deviceId,
    sequence: 1,
    issued_at: issuedAt,
    expires_at: expiresAt,
    assignments: [{
      tenant_id: DEV_TENANT_ID,
      company_id: null,
      branch_id: null,
      status: "ACTIVE" as const,
      valid_from: issuedAt,
      valid_until: null,
      role_status: "ACTIVE" as const,
      permissions: DEV_ROLE_PRESETS[preset].map((code) => ({ code, status: "ACTIVE" as const })),
    }],
    key_id: SNAPSHOT_KEY_ID,
  }, snapshotKeys.privateKey);

  const verification = new AuthorizationSnapshotVerifier(
    trustAnchors.keysFor("AUTHORIZATION_SNAPSHOT"), trustedClock, now,
  ).verify(signedSas, { userId: PRESET_USER_ID[preset], installationId: binding.installationId, deviceId: binding.deviceId });
  if (verification.decision !== "VALID") return { kind: "SNAPSHOT_REJECTED", detail: verification.decision };

  const stored = authorizationStore.activate(signedSas, {
    userId: PRESET_USER_ID[preset], installationId: binding.installationId, deviceId: binding.deviceId,
  });
  if (stored.kind !== "ACTIVATED") return { kind: "SNAPSHOT_REJECTED", detail: stored };

  return { kind: "PROVISIONED", preset };
}
