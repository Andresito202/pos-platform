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
});
