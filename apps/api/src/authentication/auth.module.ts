import { createPublicKey } from "node:crypto";
import { Module, type OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { DeviceTrustVerifier, type TrustedDeviceTrustKey } from "@pos-platform/device-trust";
import { parseApiConfig, type ApiConfig } from "../config.js";
import { AuthController } from "./auth.controller.js";
import { DeviceChallengeStore } from "./device-challenge-store.js";
import { DeviceRegistryReader } from "./device-registry-reader.js";
import { DeviceLoginVerification } from "./device-login-verification.js";
import { InMemoryClockGuard } from "./in-memory-clock-guard.js";
import { PostgresTenantLoginStore } from "./postgres-tenant-login-store.js";
import { TenantLoginService } from "./tenant-login-service.js";
import { DEVICE_LOGIN_VERIFICATION, PG_POOL, TENANT_LOGIN_SERVICE } from "./tokens.js";

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
      useFactory: (pool: Pool): TenantLoginService => new TenantLoginService(new PostgresTenantLoginStore(pool)),
    },
  ],
})
export class AuthModule {}
