import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ELECTRON_FUSES_POLICY } from "../src/electron-fuses-policy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Electron fuses packaging policy", () => {
  it("keeps NODE/inspect disabled and ASAR integrity enabled", () => {
    expect(ELECTRON_FUSES_POLICY.runAsNode).toBe(false);
    expect(ELECTRON_FUSES_POLICY.enableNodeOptionsEnvironmentVariable).toBe(false);
    expect(ELECTRON_FUSES_POLICY.enableNodeCliInspectArguments).toBe(false);
    expect(ELECTRON_FUSES_POLICY.enableEmbeddedAsarIntegrityValidation).toBe(true);
    expect(ELECTRON_FUSES_POLICY.onlyLoadAppFromAsar).toBe(true);
    expect(ELECTRON_FUSES_POLICY.enableCookieEncryption).toBe(true);
  });

  it("matches electron-builder.yml electronFuses without weakening", () => {
    const yml = readFileSync(join(root, "electron-builder.yml"), "utf8");
    expect(yml).toMatch(/electronFuses:\s*\n/);
    for (const [key, value] of Object.entries(ELECTRON_FUSES_POLICY)) {
      const pattern = new RegExp(`${key}:\\s*${value}\\b`);
      expect(yml, `${key} must equal ${value} in electron-builder.yml`).toMatch(pattern);
    }
    expect(yml).not.toMatch(/runAsNode:\s*true/);
    expect(yml).not.toMatch(/enableEmbeddedAsarIntegrityValidation:\s*false/);
    expect(yml).not.toMatch(/onlyLoadAppFromAsar:\s*false/);
  });
});
