import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
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
  readonly channel_profile?:string;
  readonly commercial_scm_gate?:string;
  readonly native_adapter?:{relative_file:string;sha256:string;size_bytes:number;target:string};
}

function buildArtifact(overrides:NodeJS.ProcessEnv={}): ArtifactReport {
  const env:NodeJS.ProcessEnv={...process.env,POS_ARTIFACT_TARGET:hostTarget};
  for(const key of ["POS_ARTIFACT_CHANNEL_PROFILE","POS_ARTIFACT_WINDOWS_PIPE_FILE","POS_ARTIFACT_WINDOWS_PIPE_SHA256"])delete env[key];
  Object.assign(env,overrides);
  const output = execFileSync(process.execPath, ["build-artifact.mjs"], {
    cwd: serviceRoot,
    env,
    encoding: "utf8",
    stdio:["ignore","pipe","pipe"],
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


/** Structural PE data only: it is never loaded and is NOT a compiled addon. */
function packagingFixture(){
  const directory=mkdtempSync(join(tmpdir(),"pos-pipe-package-"));temporaries.push(directory);
  const file=join(directory,"camacho_windows_pipe.node"),bytes=Buffer.alloc(512);
  bytes.writeUInt16LE(0x5a4d,0);bytes.writeUInt32LE(0x80,0x3c);bytes.writeUInt32LE(0x00004550,0x80);
  bytes.writeUInt16LE(0x8664,0x84);bytes.writeUInt16LE(0xf0,0x94);bytes.writeUInt16LE(0x2002,0x96);bytes.writeUInt16LE(0x20b,0x98);
  writeFileSync(file,bytes);
  const input=(value=bytes)=>{writeFileSync(file,value);return {POS_ARTIFACT_CHANNEL_PROFILE:"SCM_CANDIDATE",POS_ARTIFACT_TARGET:"win32-x64",POS_ARTIFACT_WINDOWS_PIPE_FILE:file,POS_ARTIFACT_WINDOWS_PIPE_SHA256:createHash("sha256").update(value).digest("hex")};};
  return {directory,file,bytes,input};
}
describe("SCM candidate in the existing artifact builder (PE fixture, no Windows execution)",()=>{
  it("ships the exact pinned addon and checksum in the single reproducible artifact",()=>{
    const f=packagingFixture(),candidate=buildArtifact(f.input());
    expect(candidate.channel_profile).toBe("SCM_CANDIDATE");expect(candidate.commercial_scm_gate).toBe("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
    expect(candidate.filename).not.toBe(report.filename);expect(candidate.filename).toContain("scm-candidate");
    expect(buildArtifact(f.input()).sha256).toBe(candidate.sha256);
    expect(buildArtifact().sha256).toBe(report.sha256);
    const archive=join(serviceRoot,"dist",candidate.filename),directory=mkdtempSync(join(tmpdir(),"pos-scm-extract-"));temporaries.push(directory);
    execFileSync("tar",["-xzf",archive,"-C",directory]);
    const packaged=readFileSync(join(directory,candidate.native_adapter!.relative_file));
    expect(packaged.equals(f.bytes)).toBe(true);
    expect(createHash("sha256").update(packaged).digest("hex")).toBe(candidate.native_adapter!.sha256);
    expect(readFileSync(join(directory,"native/camacho_windows_pipe.sha256"),"utf8").trim()).toBe(candidate.native_adapter!.sha256);
    const bytes=readFileSync(archive);expect(createHash("sha256").update(bytes).digest("hex")).toBe(candidate.sha256);expect(bytes.length).toBe(candidate.size_bytes);
    expect(()=>ReleaseArtifactSchema.parse({component:candidate.component,version:candidate.version,sha256:candidate.sha256,size_bytes:candidate.size_bytes})).not.toThrow();
  },120_000);
  it("rejects an absent independent checksum or absent addon",()=>{
    const f=packagingFixture(),input=f.input();
    expect(()=>buildArtifact({...input,POS_ARTIFACT_WINDOWS_PIPE_SHA256:undefined})).toThrow("WINDOWS_PIPE_SHA256_REQUIRED");
    expect(()=>buildArtifact({...input,POS_ARTIFACT_WINDOWS_PIPE_FILE:join(f.directory,"missing.node")})).toThrow("ENOENT");
  });
  it("rejects tampered bytes against the independently supplied build hash",()=>{
    const f=packagingFixture(),input=f.input();f.bytes[511]=1;writeFileSync(f.file,f.bytes);
    expect(()=>buildArtifact(input)).toThrow("WINDOWS_PIPE_CHECKSUM_MISMATCH");
  });
  it.each(["architecture","format","dll","offset"])("rejects wrong PE %s even when its hash matches",kind=>{
    const f=packagingFixture();if(kind==="architecture")f.bytes.writeUInt16LE(0xaa64,0x84);
    if(kind==="format")f.bytes.writeUInt16LE(0,0);if(kind==="dll")f.bytes.writeUInt16LE(2,0x96);
    if(kind==="offset")f.bytes.writeUInt32LE(0xffffffff,0x3c);
    expect(()=>buildArtifact(f.input())).toThrow(kind==="architecture"?"WINDOWS_PIPE_ARCHITECTURE_REJECTED":kind==="dll"?"WINDOWS_PIPE_DLL_REJECTED":"WINDOWS_PIPE_PE_REJECTED");
  });
  it("rejects unsupported targets, unknown profiles and ignored addon inputs",()=>{
    const f=packagingFixture(),input=f.input();
    expect(()=>buildArtifact({...input,POS_ARTIFACT_TARGET:"linux-x64"})).toThrow("WINDOWS_PIPE_ARTIFACT_TARGET_REJECTED");
    expect(()=>buildArtifact({...input,POS_ARTIFACT_CHANNEL_PROFILE:"PRODUCTION"})).toThrow("ARTIFACT_CHANNEL_PROFILE_REJECTED");
    expect(()=>buildArtifact({...input,POS_ARTIFACT_CHANNEL_PROFILE:"INTERACTIVE"})).toThrow("WINDOWS_PIPE_REQUIRES_SCM_ARTIFACT_PROFILE");
  });
  it.skipIf(process.platform==="win32")("rejects symbolic link inputs",()=>{
    const f=packagingFixture(),input=f.input(),link=join(f.directory,"link.node");symlinkSync(f.file,link);
    expect(()=>buildArtifact({...input,POS_ARTIFACT_WINDOWS_PIPE_FILE:link})).toThrow("WINDOWS_PIPE_INPUT_FILE_REJECTED");
  });
});
