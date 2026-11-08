import { ServiceLifecycle } from "../lifecycle.js";
import { LocalDatabaseComponent } from "../local-database-component.js";
import type { OperationalLicenseInformation } from "../security/license-capacity-gate.js";

/** Unprovisioned host composition only. No handler, channel, session or authority is created. */
export class AndroidServiceFoundation {
  private readonly database: LocalDatabaseComponent;
  private readonly lifecycle: ServiceLifecycle;
  constructor(directory: string) {
    this.database = new LocalDatabaseComponent(directory);
    // DEC-020: no outbox/commercial component may start before local-security.
    this.lifecycle = new ServiceLifecycle([this.database]);
  }
  async start(): Promise<void> { await this.lifecycle.start(); }
  async stop(): Promise<void> { await this.lifecycle.stop(); }
  licenseInformation(): OperationalLicenseInformation {
    // No installation/device trust exists in this composition. A running DB is
    // never substituted for enrollment or for an accepted signed capacity.
    return {status:"UNVERIFIED",signedValidUntil:null,lastAcceptedLocalCheck:null,evaluatedAt:null};
  }
  status() {
    return {
      component: "android-service-foundation" as const,
      state: this.lifecycle.state,
      commercial_access: "BLOCKED_PENDING_TRUSTED_PROVISIONING" as const,
      components: ["local-database"] as const,
      local_security: "NOT_PROVISIONED" as const,
      external_channel: "CLOSED" as const,
    };
  }
}
