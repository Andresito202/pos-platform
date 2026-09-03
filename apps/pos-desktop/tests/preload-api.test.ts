import { describe, it, expect } from "vitest";
import { RENDERER_API_KEY, RENDERER_API_METHODS, isValidMethod } from "../src/preload-api.js";

describe("preload-api", () => {
  it("exposes the correct API key", () => {
    expect(RENDERER_API_KEY).toBe("posService");
  });

  it("exposes exactly the three allowed methods", () => {
    expect(RENDERER_API_METHODS).toContain("runtime.status.get");
    expect(RENDERER_API_METHODS).toContain("operation.result.get");
    expect(RENDERER_API_METHODS).toContain("operation.confirm");
    expect(RENDERER_API_METHODS).toHaveLength(3);
  });

  it("does not expose runtime.handshake to renderer", () => {
    expect(isValidMethod("runtime.handshake")).toBe(false);
    expect(Array.from(RENDERER_API_METHODS)).not.toContain("runtime.handshake");
  });

  it("validates all exposed methods", () => {
    for (const method of RENDERER_API_METHODS) {
      expect(isValidMethod(method)).toBe(true);
    }
  });

  it("rejects arbitrary method names", () => {
    expect(isValidMethod("fs.read")).toBe(false);
    expect(isValidMethod("shell.open")).toBe(false);
    expect(isValidMethod("ipcRenderer")).toBe(false);
    expect(isValidMethod("")).toBe(false);
    expect(isValidMethod("runtime.status.get.extra")).toBe(false);
  });
});
