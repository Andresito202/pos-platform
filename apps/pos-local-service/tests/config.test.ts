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
  it("accepts only an absolute installer-managed SAS provision path and keeps it absent by default",()=>{
    expect(parseServiceConfig(valid).authorization_trust_provision_file).toBeUndefined();
    expect(()=>parseServiceConfig({...valid,POS_AUTHORIZATION_TRUST_PROVISION_FILE:"relative.json"})).toThrow();
    expect(parseServiceConfig({...valid,POS_AUTHORIZATION_TRUST_PROVISION_FILE:valid.POS_DATA_DIRECTORY+"/sas.json"}).authorization_trust_provision_file).toBe(valid.POS_DATA_DIRECTORY+"/sas.json");
  });
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

  it("accepts the authenticated central trust distribution configuration", () => {
    const parsed = parseServiceConfig({
      ...valid,
      POS_CENTRAL_BASE_URL: "https://api.camachopos.co",
      POS_SESSION_TRUST_ENVIRONMENT: "production",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE: "/var/lib/camacho-pos/security/session-trust-token",
    });
    expect(parsed.session_trust_transport_token_file).toBe("/var/lib/camacho-pos/security/session-trust-token");
  });

  it("requires central HTTPS and a root trust anchor for remote trust distribution", () => {
    expect(() => parseServiceConfig({
      ...valid,
      POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE: "/var/lib/camacho-pos/security/session-trust-token",
    })).toThrow("session trust transport token requires POS_CENTRAL_BASE_URL");
    expect(() => parseServiceConfig({
      ...valid,
      POS_CENTRAL_BASE_URL: "https://api.camachopos.co",
      POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE: "/var/lib/camacho-pos/security/session-trust-token",
    })).toThrow("central session trust distribution requires the configured root public key and environment");
  });

  it("rejects a relative session trust transport token path", () => {
    expect(() => parseServiceConfig({
      ...valid,
      POS_CENTRAL_BASE_URL: "https://api.camachopos.co",
      POS_SESSION_TRUST_ENVIRONMENT: "production",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE: "./token",
    })).toThrow("session trust transport token file path must be absolute");
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
