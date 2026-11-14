import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProductionDesktopProvisioning, loadOrCreateWindowsLocalChannelSecret } from "../src/windows-production.js";

describe("production Windows channel provisioning", () => {
  it("fails closed when production identity is incomplete", () => {
    expect(() => loadProductionDesktopProvisioning({}, "win32")).toThrow(
      "POS_DATA_DIRECTORY is required for production desktop bootstrap",
    );
  });

  it("never creates a channel secret or DPAPI key from Desktop on first run", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-desktop-no-boot-"));
    try {
      expect(() => loadProductionDesktopProvisioning({
        POS_DATA_DIRECTORY: directory,
        POS_INSTALLATION_ID: "018f0000-0000-7000-8000-000000000001",
        POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
      }, "win32")).toThrow("LOCAL_CHANNEL_SECRET_NOT_PROVISIONED");
      expect(existsSync(join(directory, "security"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("service-only creation refuses invalid installation id before touching files", () => {
    expect(() => loadOrCreateWindowsLocalChannelSecret("C:\\\\untrusted", "invalid-installation-id", "win32"))
      .toThrow("invalid installation id for service channel bootstrap");
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;
  windowsIt("Service provisions the channel; Desktop consumes the same key without rotating it", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-same-logon-channel-"));
    const installation = "018f0000-0000-7000-8000-000000000001";
    try {
      const serviceSecret = loadOrCreateWindowsLocalChannelSecret(directory, installation);
      const rootKeyFiles = readdirSync(join(directory, "security", "dpapi"));
      expect(rootKeyFiles).toHaveLength(1);
      const desktop = loadProductionDesktopProvisioning({
        POS_DATA_DIRECTORY: directory, POS_INSTALLATION_ID: installation,
        POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
      });
      expect(desktop.channelSecret.equals(serviceSecret)).toBe(true);
      expect(readdirSync(join(directory, "security", "dpapi"))).toEqual(rootKeyFiles);
      desktop.channelSecret.fill(0);serviceSecret.fill(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 25_000);

  it("rejects a relative Desktop storage directory before any DPAPI call", () => {
    expect(() => loadProductionDesktopProvisioning({
      POS_DATA_DIRECTORY: "relative-channel-store",
      POS_INSTALLATION_ID: "018f0000-0000-7000-8000-000000000001",
      POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
    }, "win32")).toThrow("LOCAL_CHANNEL_DATA_DIRECTORY_MUST_BE_ABSOLUTE");
  });

  windowsIt("rejects tampered or malformed encrypted channel envelopes without rewriting", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-channel-envelope-"));
    const installation = "018f0000-0000-7000-8000-000000000001";
    const environment = {
      POS_DATA_DIRECTORY: directory,
      POS_INSTALLATION_ID: installation,
      POS_DEVICE_ID: "018f0000-0000-7000-8000-000000000002",
    };
    try {
      const key = loadOrCreateWindowsLocalChannelSecret(directory, installation);
      key.fill(0);
      const path = join(directory, "security", "local-channel-auth.secret");
      const original = readFileSync(path, "utf8");
      const envelope = JSON.parse(original) as Record<string, unknown>;
      const ciphertext = envelope.ciphertext as string;
      envelope.ciphertext = (ciphertext.startsWith("A") ? "B" : "A") + ciphertext.slice(1);
      const forged = JSON.stringify(envelope);
      writeFileSync(path, forged);
      expect(() => loadProductionDesktopProvisioning(environment)).toThrow("LOCAL_CHANNEL_SECRET_AUTHENTICATION_FAILED");
      expect(readFileSync(path, "utf8")).toBe(forged);

      writeFileSync(path, JSON.stringify({ version: 1, iv: "AA", tag: "", ciphertext: "AA" }));
      expect(() => loadProductionDesktopProvisioning(environment)).toThrow("LOCAL_CHANNEL_SECRET_FILE_REJECTED");

      writeFileSync(path, original);
      const reader = loadProductionDesktopProvisioning(environment);
      expect(reader.channelSecret).toHaveLength(32);
      reader.channelSecret.fill(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 25_000);

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
