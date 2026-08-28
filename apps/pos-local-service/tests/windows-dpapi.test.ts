import { readdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WindowsDpapiKeyProvider } from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-dpapi-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const windowsIt = process.platform === "win32" ? it : it.skip;

describe("Windows DPAPI root key provider", () => {
  windowsIt("persists one OS-bound key per context without plaintext storage", async () => {
    const dir = await directory();
    const firstProvider = new WindowsDpapiKeyProvider(dir);
    const first = firstProvider.loadKey("installation-a");
    const second = new WindowsDpapiKeyProvider(dir).loadKey("installation-a");
    const other = new WindowsDpapiKeyProvider(dir).loadKey("installation-b");

    expect(firstProvider.protection).toBe("OS_BOUND");
    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
    expect(other.equals(first)).toBe(false);

    const files = readdirSync(dir).filter((name) => name.endsWith(".dpapi"));
    expect(files).toHaveLength(2);
    expect(files.some((name) => name.includes("installation-a"))).toBe(false);

    first.fill(0);
    second.fill(0);
    other.fill(0);
  });
});
