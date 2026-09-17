import { readFileSync } from "node:fs";
import { SessionAssertionTrustBundleSchema, type SessionAssertionTrustBundle } from "@pos-platform/contracts";

/**
 * Publishes an already root-signed SESSION_ASSERTION trust bundle.
 *
 * Central Authority never creates the root trust decision here. The bundle is
 * signed offline/by the product trust root and this component only validates
 * its public contract before serving it.
 */
export class SessionTrustPublication {
  constructor(private readonly artifactPath: string) {}

  load(): SessionAssertionTrustBundle {
    return SessionAssertionTrustBundleSchema.parse(
      JSON.parse(readFileSync(this.artifactPath, "utf8")),
    );
  }
}
