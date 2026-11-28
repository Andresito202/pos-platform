import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as z from "zod";
import {
  UuidSchema,
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
import { acknowledgeLicenseLocalAcceptance, downloadLicenseCapacity } from "../security/license-capacity-download.js";
import {
  commercialLicenseCapacitySealStore,
  LicenseCapacityGate,
  LicenseCapacityProvisionSchema,
  parseLicenseCapacityKeys,
  readLicenseCapacityProvision,
} from "../security/license-capacity-gate.js";
import type { DeviceCredentialProvider } from "../sync/device-credential.js";
import { TrustedClockGuard } from "../security/trusted-clock.js";
import { AndroidBusinessNativeCentralClient } from "./android-business-native-central.js";

const ms = z.number().int().positive().max(60_000);

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
  sync_origin: z.string().optional(),
  license_activation: z.strictObject({
    activation_id: UuidSchema,
    register_id: UuidSchema,
    keys: LicenseCapacityProvisionSchema.shape.keys,
  }).optional(),
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
  if (parsed.registration.androidPackageId !== "co.camachopos.colombia") throw new Error("ANDROID_COMMERCIAL_PACKAGE_REJECTED");
  if (!centralOrigin || parsed.registration.authorizationOrigin !== new URL(centralOrigin).origin) {
    throw new Error("ANDROID_COMMERCIAL_CENTRAL_ORIGIN_MISMATCH");
  }
  if (parsed.sync_origin !== undefined) validateCommercialHttpsOrigin(parsed.sync_origin);
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
export function createAndroidCentralServices(
  deps: AndroidNativeCentralDeps,
): {
  client: AndroidBusinessNativeCentralClient;
  sync?: { origin: string; credentials: DeviceCredentialProvider };
  destroy(): void;
} | null {
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
    const activation = provision.license_activation;
    const licensePath = deps.config.license_capacity_provision_file;
    if (activation && !licensePath) {
      credentialSecrets.destroy();
      return null;
    }
    const acceptLicense = activation && licensePath
      ? managedLicenseAcceptance(deps, provider, origin, licensePath, activation, provision.request_timeout_ms,
        provision.environment === "PREPRODUCTION")
      : undefined;
    const client = new AndroidBusinessNativeCentralClient(
      origin,
      provider,
      fetch,
      provision.request_timeout_ms,
      { clientId: provision.registration.clientId, redirectUri: provision.registration.redirectUri, audience: provision.audience },
      acceptLicense,
    );
    const sync = provision.sync_origin === undefined ? undefined : {
      origin: provision.sync_origin,
      credentials: {
        isProvisioned() {
          try { return Boolean(provider.requireVerifiedCredentialId()); }
          catch { return false; }
        },
        authorization: provider.syncAuthorization.bind(provider, deps.config.branch_id),
      },
    };
    return { client, ...(sync ? { sync } : {}), destroy: () => credentialSecrets.destroy() };
  } catch {
    credentialSecrets.destroy();
    return null;
  }
}

function managedLicenseAcceptance(
  deps: AndroidNativeCentralDeps,
  provider: CommercialDeviceCredentialProvider,
  origin: string,
  provisionFile: string,
  activation: NonNullable<AndroidCommercialProvision["license_activation"]>,
  timeoutMs: number,
  acknowledgePreproduction: boolean,
): () => Promise<void> {
  parseLicenseCapacityKeys(activation.keys);
  const database = deps.database.database;
  const scope = {
    tenantId: deps.config.tenant_id,
    companyId: deps.config.company_id,
    branchId: deps.config.branch_id,
    installationId: deps.config.installation_id,
    deviceId: deps.config.device_id,
  };
  const gate = new LicenseCapacityGate(
    database,
    () => readLicenseCapacityProvision(provisionFile),
    deps.now,
    commercialLicenseCapacitySealStore(provisionFile, scope.installationId),
  );
  return async () => {
    const result = await downloadLicenseCapacity({
      origin,
      activationId: activation.activation_id,
      provisionFile,
      trustKeys: activation.keys,
      binding: scope,
      allocation: { branchId: scope.branchId, registerId: activation.register_id },
      database,
      provider,
      timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (result.status === "REVOKED") throw new Error("LICENSE_REVOKED");
    if (!result.usableNow) throw new Error("LICENSE_NOT_YET_VALID");
    const denied = gate.authorize(scope, activation.register_id);
    if (denied) throw new Error(denied);
    if (acknowledgePreproduction) {
      await acknowledgeLicenseLocalAcceptance({
        origin, activationId: activation.activation_id, payloadChecksum: result.payloadChecksum, timeoutMs, provider,
      });
    }
  };
}

export function androidSecurityDirectory(dataDirectory: string): string {
  return join(dataDirectory, "..", "security");
}
