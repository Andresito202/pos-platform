import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/**
 * Lo que se puede comprobar sin Windows, y por tanto en CI.
 *
 * El script de DPAPI estuvo **duplicado**: una copia en el servicio y otra en
 * `@pos-platform/local-channel`, identicas en significado y distintas en
 * formato. Nada las comparaba, asi que arreglar una no habria alcanzado a la
 * otra y nada habria fallado al no alcanzarla.
 *
 * Es la misma forma de envejecer que ya costo doce dias en
 * `business-readiness.md`: dos superficies para el mismo dato. Se resolvio
 * dejando una sola y esto impide que vuelvan a ser dos.
 */
describe("el script de DPAPI existe una sola vez", () => {
  it("no hay una segunda copia esperando a divergir", () => {
    const root = fileURLToPath(new URL("../../..", import.meta.url));
    // Sólo fuentes: `dist/` lleva copias empaquetadas del mismo script —son
    // el mismo origen compilado, no una segunda definición— y esta propia
    // prueba contiene la cadena que busca.
    const sources = [
      ...globSync("{apps,packages}/*/src/**/*.ts", { cwd: root }),
      ...globSync("tools/**/*.mjs", { cwd: root }),
    ].filter((file) => !file.includes("node_modules"));

    const definitions = sources.filter((file) =>
      readFileSync(`${root}/${file}`, "utf8").includes("DPAPI_SCRIPT = String.raw"));

    expect(
      definitions,
      "el script de DPAPI tiene que definirse en un solo sitio; el servicio lo importa de local-channel",
    ).toEqual(["packages/local-channel/src/windows-production.ts"]);
  });
});

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

    for (const file of files) {
      const path = join(dir, file);
      const script = String.raw`
$ErrorActionPreference = "Stop"
$path = $env:POS_DPAPI_TEST_PATH
$acl = [System.IO.File]::GetAccessControl($path)
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules = @(
  $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) |
    ForEach-Object { $_.IdentityReference.Value }
)
[pscustomobject]@{
  protected = $acl.AreAccessRulesProtected
  owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  current = $current
  rules = $rules
} | ConvertTo-Json -Compress
`;
      const result = spawnSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        {
          encoding: "utf8",
          windowsHide: true,
          env: { ...process.env, POS_DPAPI_TEST_PATH: path },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const acl = JSON.parse(result.stdout.trim()) as {
        protected: boolean;
        owner: string;
        current: string;
        rules: string[] | string;
      };
      const rules = Array.isArray(acl.rules) ? acl.rules : [acl.rules];
      expect(acl.protected).toBe(true);
      expect(acl.owner).toBe(acl.current);
      expect(rules).toContain(acl.current);
      expect(rules).not.toContain("S-1-1-0");
      expect(rules).not.toContain("S-1-5-7");
      expect(rules).not.toContain("S-1-5-11");
      expect(rules).not.toContain("S-1-5-32-545");
    }

    first.fill(0);
    second.fill(0);
    other.fill(0);
  }, 20_000);
});
