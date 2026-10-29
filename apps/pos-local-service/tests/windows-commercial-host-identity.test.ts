import { describe, expect, it } from "vitest";
import { assertWindowsCommercialInteractiveHost } from "../src/security/windows-commercial-host-identity.js";

describe("Windows commercial process identity", () => {
  it.runIf(process.platform==="win32")("real Windows token: verifies the current interactive host without an injected runner",()=>{
    // Actual PowerShell/WindowsIdentity; no user name, SID or secret is logged.
    // This does not certify another Windows account, SCM, Central or human MFA.
    expect(()=>assertWindowsCommercialInteractiveHost()).not.toThrow();
  });
  it("rejects non-Windows runtime before invoking the host", () => {
    expect(() => assertWindowsCommercialInteractiveHost("linux", () => {
      throw new Error("runner must not run");
    })).toThrow("COMMERCIAL_WINDOWS_HOST_REQUIRED");
  });

  it("accepts only the exact successful operating-system attestation", () => {
    expect(() => assertWindowsCommercialInteractiveHost("win32", () => ({
      status: 0,
      stdout: "COMMERCIAL_INTERACTIVE_CONTEXT_VERIFIED\r\n",
    }))).not.toThrow();

    expect(() => assertWindowsCommercialInteractiveHost("win32", () => ({
      status: 0,
      stdout: "COMMERCIAL_INTERACTIVE_CONTEXT_VERIFIED\nSPOOFED_PAYLOAD",
    }))).toThrow("COMMERCIAL_WINDOWS_INTERACTIVE_IDENTITY_REQUIRED");
  });

  it("denies SCM, non-interactive or missing identity without exposing native details", () => {
    for (const status of [11,12,13]) {
      expect(() => assertWindowsCommercialInteractiveHost("win32", () => ({
        status, stdout: "PRIVATE_SID_SHOULD_NOT_ESCAPE",
      }))).toThrow("COMMERCIAL_WINDOWS_INTERACTIVE_IDENTITY_REQUIRED");
    }
    expect(() => assertWindowsCommercialInteractiveHost("win32", () => ({
      status: null,
      error: new Error("PRIVATE_USER_NAME_SHOULD_NOT_ESCAPE"),
    }))).toThrow("COMMERCIAL_WINDOWS_IDENTITY_INSPECTION_FAILED");
  });

  it("rejects success exit without the exact attestation and rejects arbitrary nonzero codes", () => {
    expect(() => assertWindowsCommercialInteractiveHost("win32", () => ({
      status: 0, stdout: "",
    }))).toThrow("COMMERCIAL_WINDOWS_INTERACTIVE_IDENTITY_REQUIRED");
    for (const status of [1, 99]) {
      expect(() => assertWindowsCommercialInteractiveHost("win32", () => ({
        status, stdout: "COMMERCIAL_INTERACTIVE_CONTEXT_VERIFIED",
      }))).toThrow("COMMERCIAL_WINDOWS_INTERACTIVE_IDENTITY_REQUIRED");
    }
  });

  it("fails closed when inspection itself fails", () => {
    expect(() => assertWindowsCommercialInteractiveHost("win32", () => {
      throw new Error("PRIVATE_TOKEN_DETAILS");
    })).toThrow("COMMERCIAL_WINDOWS_IDENTITY_INSPECTION_FAILED");
  });
});
