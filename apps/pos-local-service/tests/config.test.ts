import { describe, expect, it } from "vitest";
import { parseServiceConfig } from "../src/index.js";

const valid = {
  POS_DATA_DIRECTORY: "/var/lib/camacho-pos",
  POS_INSTALLATION_ID: "018f0000-0000-7000-8000-000000000001",
  POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
  POS_SERVICE_VERSION: "1.0.0",
  POS_PROTOCOL_MIN: "1.0.0",
  POS_PROTOCOL_MAX: "1.0.0",
  POS_TENANT_ID: "018f0000-0000-7000-8000-000000000003",
  POS_COMPANY_ID: "018f0000-0000-7000-8000-000000000004",
  POS_BRANCH_ID: "018f0000-0000-7000-8000-000000000005",
};

const rootPublicKeyPem = "-----BEGIN PUBLIC KEY-----\n" + "A".repeat(44) + "\n-----END PUBLIC KEY-----";

describe("parseServiceConfig", () => {
  it("fails closed when required configuration is absent", () => {
    expect(() => parseServiceConfig({})).toThrow();
  });
  it("parses an explicit configuration", () => {
    expect(parseServiceConfig(valid).service_version).toBe("1.0.0");
  });
  it("rejects a relative data directory before normalization", () => {
    expect(() => parseServiceConfig({ ...valid, POS_DATA_DIRECTORY: "./data" })).toThrow("must be absolute");
  });
  it("rejects an inverted protocol compatibility range", () => {
    expect(() => parseServiceConfig({
      ...valid,
      POS_PROTOCOL_MIN: "2.0.0",
      POS_PROTOCOL_MAX: "1.9.9",
    })).toThrow("protocol_max must be greater than or equal to protocol_min");
  });

  it("rejects unknown POS-prefixed configuration", () => {
    expect(() => parseServiceConfig({ ...valid, POS_UNDECLARED_OPTION: "1" })).toThrow("unknown POS service configuration");
  });

  it("treats the central origin as absent by default", () => {
    // Sin origen central el outbox acumula durablemente: es el comportamiento
    // correcto de un equipo local-first sin autoridad a la que hablar.
    expect(parseServiceConfig(valid).central_base_url).toBeUndefined();
  });

  it("accepts an https central origin", () => {
    expect(parseServiceConfig({ ...valid, POS_CENTRAL_BASE_URL: "https://api.camachopos.co" }).central_base_url)
      .toBe("https://api.camachopos.co");
  });

  it("rejects a central origin without TLS", () => {
    // `DEC-007:1563` («HTTPS obligatorio») e `integration-contracts.md:372`.
    expect(() => parseServiceConfig({ ...valid, POS_CENTRAL_BASE_URL: "http://api.camachopos.co" })).toThrow();
  });

  it("requires session trust environment and root public key as a pair", () => {
    expect(() => parseServiceConfig({
      ...valid,
      POS_SESSION_TRUST_ENVIRONMENT: "production",
    })).toThrow("session trust environment and root public key must be configured together");
    expect(() => parseServiceConfig({
      ...valid,
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
    })).toThrow("session trust environment and root public key must be configured together");
  });

  it("accepts the complete session trust bootstrap configuration", () => {
    const parsed = parseServiceConfig({
      ...valid,
      POS_SESSION_TRUST_ENVIRONMENT: "production",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_ARTIFACT_PATH: "/var/lib/camacho-pos/security/session-trust.json",
    });
    expect(parsed.session_trust_environment).toBe("production");
    expect(parsed.session_trust_root_public_key_pem).toBe(rootPublicKeyPem);
    expect(parsed.session_trust_artifact_path).toBe("/var/lib/camacho-pos/security/session-trust.json");
  });

  it("rejects a relative session trust artifact path", () => {
    expect(() => parseServiceConfig({
      ...valid,
      POS_SESSION_TRUST_ENVIRONMENT: "production",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_ARTIFACT_PATH: "./session-trust.json",
    })).toThrow("session trust artifact path must be absolute");
  });
});
