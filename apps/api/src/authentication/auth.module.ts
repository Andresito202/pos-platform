import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { Module, type OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { DeviceTrustVerifier, type TrustedDeviceTrustKey } from "@pos-platform/device-trust";
import { parseApiConfig, type ApiConfig } from "../config.js";
import { AuthController } from "./auth.controller.js";
import { DeviceChallengeStore } from "./device-challenge-store.js";
import { DeviceRegistryReader } from "./device-registry-reader.js";
import { DeviceLoginVerification } from "./device-login-verification.js";
import { InMemoryClockGuard } from "./in-memory-clock-guard.js";
import { MfaEnrollmentService } from "./mfa-enrollment-service.js";
import { MfaSecretCipher } from "./mfa-secret-cipher.js";
import { OperatorSessionIssuer, type SessionTrustSigningKey } from "./operator-session-issuer.js";
import { PostgresTenantLoginStore } from "./postgres-tenant-login-store.js";
import { TenantLoginService } from "./tenant-login-service.js";
import { DEVICE_LOGIN_VERIFICATION, MFA_ENROLLMENT_SERVICE, PG_POOL, TENANT_LOGIN_SERVICE } from "./tokens.js";

function signingKey(keyId: string, file: string): SessionTrustSigningKey {
  const privateKey = createPrivateKey(readFileSync(file));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error(`${keyId} must be an Ed25519 private key`);
  return { keyId, privateKey };
}

/** `null` sin claves de emisión: login central sin sesión local (`DEC-026` §13.10). */
function operatorSessionIssuer(config: ApiConfig): OperatorSessionIssuer | null {
  const signing = config.session_trust_signing;
  if (signing === null) return null;
  return new OperatorSessionIssuer(
    signingKey(signing.session_assertion_key_id, signing.session_assertion_key_file),
    signingKey(signing.authorization_snapshot_key_id, signing.authorization_snapshot_key_file),
  );
}

class PoolCloser implements OnModuleDestroy {
  constructor(private readonly pool: Pool) {}
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const config: ApiConfig = parseApiConfig(process.env);
        return new Pool({ connectionString: config.central_database_url, max: 10, application_name: "pos-platform-api" });
      },
    },
    {
      provide: PoolCloser,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PoolCloser(pool),
    },
    {
      provide: DEVICE_LOGIN_VERIFICATION,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DeviceLoginVerification => {
        const config = parseApiConfig(process.env);
        const operationalKeys = new Map<string, TrustedDeviceTrustKey>([
          [config.device_trust_operational_key_id, {
            key: createPublicKey(config.device_trust_operational_public_key_pem),
            status: "ACTIVE",
            validFrom: new Date(0).toISOString(),
          }],
        ]);
        const verifier = new DeviceTrustVerifier(
          createPublicKey(config.device_trust_root_public_key_pem),
          operationalKeys,
          new InMemoryClockGuard(),
        );
        return new DeviceLoginVerification(new DeviceRegistryReader(pool), new DeviceChallengeStore(), verifier);
      },
    },
    {
      provide: TENANT_LOGIN_SERVICE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): TenantLoginService => {
        const config = parseApiConfig(process.env);
        return new TenantLoginService(
          new PostgresTenantLoginStore(pool), undefined, undefined, undefined,
          new MfaSecretCipher(config.mfa_secret_encryption_key),
          operatorSessionIssuer(config),
        );
      },
    },
    {
      provide: MFA_ENROLLMENT_SERVICE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): MfaEnrollmentService => {
        const config = parseApiConfig(process.env);
        return new MfaEnrollmentService(
          new PostgresTenantLoginStore(pool),
          new MfaSecretCipher(config.mfa_secret_encryption_key),
          config.mfa_totp_issuer,
        );
      },
    },
  ],
})
export class AuthModule {}
