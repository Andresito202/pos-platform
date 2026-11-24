import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as z from "zod";
import {
  validateCommercialHttpsOrigin,
  validateCommercialPosRegistration,
  type NativeClientRegistration,
} from "@pos-platform/contracts";
import { DeviceTrustVerifier } from "@pos-platform/device-trust";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import type { ServiceConfig } from "../config.js";
import { CommercialDeviceCredentialProvider } from "../security/commercial-device-credential.js";
import { DeviceTrustCredentialStore } from "../security/device-trust-credential-store.js";
import { EncryptedFileSecretStore, type SecretStoreKeyProvider } from "../security/encrypted-secret-store.js";
import { LocalSecurityComponent } from "../security/local-security-component.js";
import { TrustedClockGuard } from "../security/trusted-clock.js";
import { AndroidBusinessNativeCentralClient } from "./android-business-native-central.js";

const ms = z.number().int().positive().max(2_147_483_647);

/** Installer-owned Android commercial custody. Presence alone never authenticates. */
export const AndroidCommercialProvisionSchema = z.strictObject({
  profile: z.literal("CAMACHO_ANDROID_COMMERCIAL_V2"),
  environment: z.enum(["PREPRODUCTION", "PRODUCTION"]),
  registration: z.strictObject({
    clientId: z.string(),
    redirectUri: z.string(),
    authorizationOrigin: z.string(),
    platform: z.literal("ANDROID"),
    androidPackageId: z.string(),
    androidSigningCertificateSha256: z.string(),
  }),
  rp_id: z.string(),
  webauthn_origin: z.string(),
  audience: z.string().min(1).max(128),
  device_trust_root_public_key_pem: z.string().min(80).max(4096),
  device_trust_root_spki_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  device_trust_operational_keys: z.array(z.unknown()).min(1).max(32),
  request_timeout_ms: ms,
});

export type AndroidCommercialProvision = z.infer<typeof AndroidCommercialProvisionSchema>;

export function readAndroidCommercialProvision(
  path: string,
  centralOrigin: string | undefined,
): AndroidCommercialProvision {
  if (!isAbsolute(path)) throw new Error("ANDROID_COMMERCIAL_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131_072) {
    throw new Error("ANDROID_COMMERCIAL_MANAGED_FILE_REJECTED");
  }
  const parsed = AndroidCommercialProvisionSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path))),
  );
  validateCommercialPosRegistration(parsed.registration, parsed.rp_id, parsed.webauthn_origin);
  if (!centralOrigin || parsed.registration.authorizationOrigin !== new URL(centralOrigin).origin) {
    throw new Error("ANDROID_COMMERCIAL_CENTRAL_ORIGIN_MISMATCH");
  }
  const root = createPublicKey(parsed.device_trust_root_public_key_pem);
  if (
    root.asymmetricKeyType !== "ed25519"
    || createHash("sha256").update(root.export({ type: "spki", format: "der" })).digest("hex")
      !== parsed.device_trust_root_spki_sha256
  ) {
    throw new Error("ANDROID_COMMERCIAL_PROVISIONED_ROOT_REJECTED");
  }
  return Object.freeze({
    ...parsed,
    registration: Object.freeze({ ...parsed.registration }) as NativeClientRegistration & {
      platform: "ANDROID";
      androidPackageId: string;
      androidSigningCertificateSha256: string;
    },
  });
}

export type AndroidNativeCentralDeps = {
  readonly config: ServiceConfig;
  readonly database: LocalDatabaseComponent;
  readonly security: LocalSecurityComponent;
  readonly keyProvider: SecretStoreKeyProvider;
  readonly securityDirectory: string;
  readonly now: () => Date;
};

/**
 * Compose DeviceProof + Central native client when Android commercial provision
 * and enrolled Device Trust are present. Returns null fail-closed otherwise —
 * never invents credentials or SSA.
 */
export function createAndroidBusinessNativeCentralClient(
  deps: AndroidNativeCentralDeps,
): AndroidBusinessNativeCentralClient | null {
  const path = deps.config.android_commercial_provision_file;
  const origin = deps.config.central_base_url;
  if (!path || !origin) return null;
  if (deps.security.protection !== "OS_BOUND") return null;

  let provision: AndroidCommercialProvision;
  try {
    provision = readAndroidCommercialProvision(path, origin);
  } catch {
    return null;
  }
  validateCommercialHttpsOrigin(origin);
  if (provision.registration.authorizationOrigin !== origin) return null;

  const binding = {
    tenantId: deps.config.tenant_id,
    companyId: deps.config.company_id,
    installationId: deps.config.installation_id,
    deviceId: deps.config.device_id,
  };
  if (!deps.security.matchesDeviceBinding(binding)) return null;

  const credentialSecrets = new EncryptedFileSecretStore(
    deps.securityDirectory,
    deps.keyProvider,
    `device-trust:${binding.installationId}:${binding.deviceId}`,
  );
  try {
    const credentials = new DeviceTrustCredentialStore(credentialSecrets);
    if (!credentials.has()) {
      credentialSecrets.destroy();
      return null;
    }
    const keys = new Map();
    const root = createPublicKey(provision.device_trust_root_public_key_pem);
    const verifier = new DeviceTrustVerifier(root, keys, {
      now: deps.now,
      accept: (at) => new TrustedClockGuard(deps.database.database).accept(at),
    });
    for (const raw of provision.device_trust_operational_keys) {
      const checked = verifier.verifyOperationalKey(raw);
      if (checked.decision !== "VALID" || !checked.value) {
        credentialSecrets.destroy();
        return null;
      }
      const k = checked.value;
      if (keys.has(k.key_id)) {
        credentialSecrets.destroy();
        return null;
      }
      keys.set(k.key_id, {
        key: createPublicKey(k.public_key_pem),
        status: k.status,
        validFrom: k.valid_from,
      });
    }
    const provider = new CommercialDeviceCredentialProvider(
      deps.security,
      deps.database,
      credentials,
      verifier,
      binding,
    );
    // Force fail-closed check before returning a live client.
    provider.requireVerifiedCredentialId();
    return new AndroidBusinessNativeCentralClient(
      origin,
      provider,
      fetch,
      provision.request_timeout_ms,
    );
  } catch {
    credentialSecrets.destroy();
    return null;
  }
}

export function androidSecurityDirectory(dataDirectory: string): string {
  return join(dataDirectory, "..", "security");
}
