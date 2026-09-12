import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReleaseArtifactSchema } from "@pos-platform/contracts";

/**
 * El artefacto distribuible de `LOCAL_SERVICE`.
 *
 * `ReleaseArtifactSchema` exige **un fichero** con `sha256` y `size_bytes`. Esta
 * prueba construye el artefacto de verdad y comprueba que lo que sale alimenta
 * ese contrato — no que una función devuelva lo que se le dijo.
 *
 * Se construye para la plataforma **anfitriona**, no para `win32-x64`: sólo así
 * el bundle puede ejecutarse aquí y demostrar que resuelve sus dependencias y
 * carga el addon nativo. La release real se construye con el objetivo por
 * defecto; que el `win32-x64` arranque es `REQUIRES_LOCAL_VERIFICATION`.
 */

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostTarget = `${process.platform}-${process.arch}`;

/** El arranque completo toca DPAPI y el named pipe en Windows. Ahí no se ejecuta. */
const posixIt = process.platform === "win32" ? it.skip : it;

interface ArtifactReport {
  readonly component: string;
  readonly version: string;
  readonly filename: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly target: string;
}

function buildArtifact(): ArtifactReport {
  const output = execFileSync(process.execPath, ["build-artifact.mjs"], {
    cwd: serviceRoot,
    env: { ...process.env, POS_ARTIFACT_TARGET: hostTarget },
    encoding: "utf8",
  });
  return JSON.parse(output) as ArtifactReport;
}

let report: ArtifactReport;
let artifactPath: string;
const temporaries: string[] = [];

beforeAll(() => {
  report = buildArtifact();
  artifactPath = join(serviceRoot, "dist", report.filename);
}, 120_000);

afterAll(() => {
  for (const directory of temporaries.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** El entorno mínimo con el que el servicio arranca, igual que lo dará WinSW. */
function serviceEnvironment(dataDirectory: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: process.env["PATH"] ?? "",
    POS_DATA_DIRECTORY: dataDirectory,
    POS_INSTALLATION_ID: "018f0000-0000-7000-8000-0000000000a1",
    POS_DEVICE_ID: "018f0000-0000-7000-8000-0000000000a2",
    POS_SERVICE_VERSION: "1.0.0",
    POS_PROTOCOL_MIN: "1.0.0",
    POS_PROTOCOL_MAX: "1.0.0",
    POS_TENANT_ID: "018f0000-0000-7000-8000-0000000000b1",
    POS_COMPANY_ID: "018f0000-0000-7000-8000-0000000000b2",
    POS_BRANCH_ID: "018f0000-0000-7000-8000-0000000000b3",
  };
}

function extract(): string {
  const directory = mkdtempSync(join(tmpdir(), "pos-artifact-"));
  temporaries.push(directory);
  execFileSync("tar", ["-xzf", artifactPath, "-C", directory]);
  return directory;
}

describe("artefacto distribuible de LOCAL_SERVICE", () => {
  it("alimenta ReleaseArtifactSchema sin adaptación", () => {
    expect(() => ReleaseArtifactSchema.parse({
      component: report.component,
      version: report.version,
      sha256: report.sha256,
      size_bytes: report.size_bytes,
    })).not.toThrow();
    expect(report.component).toBe("LOCAL_SERVICE");
  });

  it("el hash y el tamaño declarados son los del fichero", () => {
    const bytes = readFileSync(artifactPath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.sha256);
    expect(bytes.byteLength).toBe(report.size_bytes);
  });

  it("es reproducible: reconstruir da el mismo SHA-256", () => {
    expect(buildArtifact().sha256).toBe(report.sha256);
  }, 120_000);

  it("es un solo fichero, no un directorio de piezas sueltas", () => {
    expect(report.filename.endsWith(".tar.gz")).toBe(true);
  });

  it("contiene el servicio y el addon nativo de su plataforma", () => {
    const listing = execFileSync("tar", ["-tzf", artifactPath], { encoding: "utf8" });
    expect(listing).toContain("pos-local-service.mjs");
    expect(listing).toContain(`node_modules/better-sqlite3/prebuilds/${hostTarget}.node`);
  });

  it("no arrastra los prebuilds de las demás plataformas", () => {
    const listing = execFileSync("tar", ["-tzf", artifactPath], { encoding: "utf8" });
    // Se filtra por `.node`, no por el directorio: la entrada `prebuilds/` del
    // propio tar no es un binario. El `tar` de Windows termina cada renglón en
    // CRLF, de modo que partir sólo por `\n` deja un `\r` que anula el sufijo:
    // la prueba fallaba ahí mientras el prebuild sí estaba dentro.
    const prebuilds = listing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".node"));
    expect(prebuilds).toHaveLength(1);
  });

  it("no depende del repositorio: sin workspace:*, sin tsx, sin rutas absolutas", () => {
    const bundle = readFileSync(join(extract(), "pos-local-service.mjs"), "utf8");
    expect(bundle).not.toContain("@pos-platform/");
    expect(bundle).not.toContain("tsx");
    expect(bundle).not.toContain(serviceRoot);
  });

  /**
   * El apagado ordenado **no se prueba aquí**: `process.test.ts` ya lo cubre
   * sobre el proceso real —SIGTERM, coalescencia de SIGINT+SIGTERM, y que el
   * servicio termina solo cuando nada lo mantiene residente—. Esta prueba se
   * limita a lo que sólo el artefacto puede demostrar: que arranca extraído,
   * fuera del repositorio y sin `tsx`.
   */
  posixIt("extraído fuera del repositorio, arranca con node desnudo", async () => {
    const application = extract();
    const data = mkdtempSync(join(tmpdir(), "pos-artifact-data-"));
    temporaries.push(data);

    const started = await new Promise<boolean>((resolve) => {
      const child = spawn(process.execPath, ["pos-local-service.mjs"], {
        cwd: application,
        env: { ...serviceEnvironment(data) },
      });
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(false); }, 20_000);
      let buffered = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        if (buffered.includes("runtime.started")) {
          clearTimeout(timer);
          child.kill("SIGTERM");
          resolve(true);
        }
      });
      child.once("exit", () => { clearTimeout(timer); resolve(buffered.includes("runtime.started")); });
    });

    expect(started).toBe(true);
  }, 40_000);
});
