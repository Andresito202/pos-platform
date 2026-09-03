import { describe, it, expect } from "vitest";
import { WINDOW_SECURITY_CONFIG } from "../src/window-security.js";

describe("window-security", () => {
  it("sets contextIsolation to true", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.contextIsolation).toBe(true);
  });

  it("sets nodeIntegration to false", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.nodeIntegration).toBe(false);
  });

  it("sets sandbox to true", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.sandbox).toBe(true);
  });

  it("sets webSecurity to true", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.webSecurity).toBe(true);
  });

  it("disallows insecure content", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.allowRunningInsecureContent).toBe(false);
  });

  it("disables experimental features", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.experimentalFeatures).toBe(false);
  });

  it("disables navigate on drag-drop", () => {
    expect(WINDOW_SECURITY_CONFIG.webPreferences.navigateOnDragDrop).toBe(false);
  });
});
