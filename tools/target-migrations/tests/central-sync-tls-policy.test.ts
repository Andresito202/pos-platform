import { describe, expect, it } from "vitest";
import { resolveCentralSyncListenPolicy } from "../src/central-sync-tls-policy.js";

describe("central-sync-tls-policy (DEC-024)", () => {
  it("allows lab loopback without terminator attestation", () => {
    const decision = resolveCentralSyncListenPolicy({
      CENTRAL_SYNC_TLS_MODE: "lab",
      CENTRAL_SYNC_BIND_HOST: "127.0.0.1",
      PORT: "8787",
    } as NodeJS.ProcessEnv);
    expect(decision.certificationScope).toBe("LABORATORY");
    expect(decision.host).toBe("127.0.0.1");
  });

  it("refuses production without TLS terminator attestation", () => {
    expect(() => resolveCentralSyncListenPolicy({
      CENTRAL_SYNC_TLS_MODE: "production",
      CENTRAL_SYNC_BIND_HOST: "0.0.0.0",
      PORT: "8787",
    } as NodeJS.ProcessEnv)).toThrow(/DEC024_PRODUCTION_REQUIRES_TLS_TERMINATOR/);
  });

  it("accepts production when terminator attestation is present", () => {
    const decision = resolveCentralSyncListenPolicy({
      CENTRAL_SYNC_TLS_MODE: "production",
      CENTRAL_SYNC_BEHIND_TLS_TERMINATOR: "1",
      CENTRAL_SYNC_BIND_HOST: "127.0.0.1",
      PORT: "8787",
    } as NodeJS.ProcessEnv);
    expect(decision.certificationScope).toBe("PRODUCTION_REQUIRES_PROXY_TLS");
    expect(decision.behindTlsTerminator).toBe(true);
  });

  it("forbids insecure HTTP override in production", () => {
    expect(() => resolveCentralSyncListenPolicy({
      CENTRAL_SYNC_TLS_MODE: "production",
      CENTRAL_SYNC_BEHIND_TLS_TERMINATOR: "1",
      CENTRAL_SYNC_ALLOW_INSECURE_HTTP: "1",
      PORT: "443",
    } as NodeJS.ProcessEnv)).toThrow(/DEC024_INSECURE_HTTP_OVERRIDE_FORBIDDEN/);
  });

  it("refuses lab non-loopback without terminator", () => {
    expect(() => resolveCentralSyncListenPolicy({
      CENTRAL_SYNC_TLS_MODE: "lab",
      CENTRAL_SYNC_BIND_HOST: "0.0.0.0",
      PORT: "8787",
    } as NodeJS.ProcessEnv)).toThrow(/DEC024_LAB_REFUSES_INSECURE_EXPOSURE/);
  });
});
