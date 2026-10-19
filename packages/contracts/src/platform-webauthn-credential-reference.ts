import { UuidV7Schema } from "./primitives.js";

/**
 * Opaque handle to trusted Central Authority WebAuthn public credential state.
 * This is NOT a serialized credential, secret, file path, URL, or a claim of
 * possession. identity.mfa_factors remains the canonical factor registry.
 */
export const PLATFORM_WEBAUTHN_REFERENCE_PREFIX = "webauthn:v1:";

export function isPlatformWebAuthnCredentialReference(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(PLATFORM_WEBAUTHN_REFERENCE_PREFIX)) return false;
  const opaqueId = value.slice(PLATFORM_WEBAUTHN_REFERENCE_PREFIX.length);
  return UuidV7Schema.safeParse(opaqueId).success &&
    opaqueId === opaqueId.toLowerCase();
}
