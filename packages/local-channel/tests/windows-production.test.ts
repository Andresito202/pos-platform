import { describe, expect, it } from "vitest";
import { loadProductionDesktopProvisioning } from "../src/windows-production.js";

describe("production Windows channel provisioning", () => {
  it("fails closed when production identity is incomplete", () => {
    expect(() => loadProductionDesktopProvisioning({}, "win32")).toThrow(
      "POS_DATA_DIRECTORY is required for production desktop bootstrap",
    );
  });

  it("fails closed outside Windows production transport", () => {
    expect(() =>
      loadProductionDesktopProvisioning(
        {
          POS_DATA_DIRECTORY: "/tmp/camacho-pos",
          POS_INSTALLATION_ID: "018f0000-0000-7000-8000-000000000001",
          POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
        },
        "linux",
      ),
    ).toThrow("production desktop bootstrap requires Windows named pipes");
  });
});
