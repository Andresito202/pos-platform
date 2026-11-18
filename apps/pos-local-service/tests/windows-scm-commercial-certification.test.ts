import { describe, expect, it } from "vitest";
import { assertWindowsScmCommercialCertification } from "../src/security/windows-commercial-host-identity.js";

describe("Windows SCM commercial certification gate", () => {
  it("rejects non-Windows hosts without an env bypass", () => {
    expect(() => assertWindowsScmCommercialCertification("linux", () => ({ status: 0, stdout: "SCM_COMMERCIAL_SERVICE_CONTEXT_VERIFIED" })))
      .toThrow("SCM_COMMERCIAL_WINDOWS_REQUIRED");
  });

  it("rejects interactive or forged identity receipts", () => {
    expect(() => assertWindowsScmCommercialCertification("win32", () => ({ status: 22, stdout: "" })))
      .toThrow("SCM_COMMERCIAL_SERVICE_CONTEXT_REQUIRED");
    expect(() => assertWindowsScmCommercialCertification("win32", () => ({
      status: 0,
      stdout: "COMMERCIAL_INTERACTIVE_CONTEXT_VERIFIED",
    }))).toThrow("SCM_COMMERCIAL_SERVICE_CONTEXT_REQUIRED");
  });

  it("accepts only the attested NT SERVICE Session-0 receipt", () => {
    expect(() => assertWindowsScmCommercialCertification("win32", () => ({
      status: 0,
      stdout: "SCM_COMMERCIAL_SERVICE_CONTEXT_VERIFIED\n",
    }))).not.toThrow();
  });
});
