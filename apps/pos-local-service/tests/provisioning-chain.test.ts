import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * La puesta en marcha de un equipo, **con las herramientas reales**.
 *
 * ## Qué afirma que no afirma ninguna otra prueba
 *
 * `operator-session-boot-order.test.ts` arranca el servicio con material que
 * fabrica en memoria: prueba el runtime. Esta prueba ejecuta **los dos
 * binarios que usa el propietario**, en procesos aparte y con `node` a secas,
 * y arranca el servicio con lo que ellos escriben en disco.
 *
 * Es la diferencia entre «el servicio sabe consumir un bundle correcto» y
 * «las herramientas que tenemos producen uno correcto». Lo segundo es lo que
 * decide si un equipo arranca en un mostrador, y hasta hoy no lo comprobaba
 * nada: `publish-session-trust.mjs` no existía —`SessionTrustKeyIssuer` era
 * una clase dentro de `central-authority`, no algo ejecutable— y el paso 1 de
 * la puesta en marcha no tenía con qué hacerse.
 *
 * Las dos herramientas reimplementan la serialización canónica porque corren
 * fuera del workspace compilado. Si alguna divergiera, la firma fallaría en un
 * mostrador; aquí falla en CI.
 */

const TOOLS = fileURLToPath(new URL("../../../tools/provisioning/", import.meta.url));
const SERVICE_ROOT = fileURLToPath(new URL("..", import.meta.url));

const IDS = {
  installationId: "018f0000-0000-7000-8000-0000000000a2",
  deviceId: "018f0000-0000-7000-8000-0000000000a3",
  userId: "018f0000-0000-7000-8000-0000000000a1",
  tenantId: "018f0000-0000-7000-8000-0000000000a4",
  companyId: "018f0000-0000-7000-8000-0000000000a5",
  branchId: "018f0000-0000-7000-8000-0000000000a6",
} as const;

const directories: string[] = [];

interface LogRecord { readonly event: string; readonly fields?: Record<string, unknown>; }

function run(tool: string, args: Readonly<Record<string, string>>): void {
  const result = spawnSync(process.execPath, [
    join(TOOLS, tool),
    ...Object.entries(args).flatMap(([name, value]) => [`--${name}`, value]),
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${tool} salio ${String(result.status)}: ${result.stderr}`);
}

async function bootWithRealTools(): Promise<Map<string, LogRecord>> {
  const workspace = mkdtempSync(join(tmpdir(), "cadena-"));
  directories.push(workspace);

  // La clave raiz, que en la realidad custodia el propietario.
  const root = generateKeyPairSync("ed25519");
  const rootPrivatePath = join(workspace, "root-private.pem");
  writeFileSync(rootPrivatePath, root.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "utf8");

  // Paso 1 — publicar el bundle. Genera ademas las dos claves operacionales.
  const trustDir = join(workspace, "trust");
  run("publish-session-trust.mjs", {
    "root-key": rootPrivatePath,
    "session-key-id": "SSA-2026-01",
    "snapshot-key-id": "SAS-2026-01",
    environment: "PRODUCTION",
    "out-dir": trustDir,
  });

  // Paso 2 — firmar el artefacto del operador con esas claves.
  const now = Date.now();
  const at = (ms: number): string => new Date(now + ms).toISOString();
  const inputPath = join(workspace, "operador.json");
  writeFileSync(inputPath, JSON.stringify({
    session_assertion: {
      session_id: "018f0000-0000-7000-8000-0000000000b0",
      user_id: IDS.userId,
      tenant_membership_id: "018f0000-0000-7000-8000-0000000000b1",
      installation_id: IDS.installationId,
      device_id: IDS.deviceId,
      issued_at: at(-60_000),
      offline_valid_until: at(6 * 3_600_000),
      sequence: 1,
    },
    authorization_snapshot: {
      snapshot_id: "018f0000-0000-7000-8000-0000000000c0",
      user_id: IDS.userId,
      installation_id: IDS.installationId,
      device_id: IDS.deviceId,
      sequence: 1,
      issued_at: at(-60_000),
      expires_at: at(12 * 3_600_000),
      assignments: [{
        tenant_id: IDS.tenantId,
        company_id: IDS.companyId,
        branch_id: IDS.branchId,
        status: "ACTIVE",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: [{ code: "CATALOG_PRODUCT_REGISTER", status: "ACTIVE" }],
      }],
    },
  }), "utf8");

  const artifactPath = join(workspace, "operator-session.json");
  run("sign-operator-session.mjs", {
    "session-key": join(trustDir, "session-assertion-private.pem"),
    "session-key-id": "SSA-2026-01",
    "snapshot-key": join(trustDir, "authorization-snapshot-private.pem"),
    "snapshot-key-id": "SAS-2026-01",
    input: inputPath,
    output: artifactPath,
  });

  // Paso 3 — arrancar el servicio con lo que escribieron.
  const child = spawn(process.execPath, [
    join(SERVICE_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "src/main.ts",
  ], {
    cwd: SERVICE_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      POS_DATA_DIRECTORY: join(workspace, "data"),
      POS_INSTALLATION_ID: IDS.installationId,
      POS_DEVICE_ID: IDS.deviceId,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: IDS.tenantId,
      POS_COMPANY_ID: IDS.companyId,
      POS_BRANCH_ID: IDS.branchId,
      POS_SESSION_TRUST_ENVIRONMENT: "PRODUCTION",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: root.publicKey.export({ type: "spki", format: "pem" }).toString(),
      POS_SESSION_TRUST_ARTIFACT_PATH: join(trustDir, "session-trust.json"),
      POS_OPERATOR_SESSION_ARTIFACT_PATH: artifactPath,
    },
  }) as ChildProcessWithoutNullStreams;

  try {
    return await new Promise<Map<string, LogRecord>>((resolve, reject) => {
      const records = new Map<string, LogRecord>();
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("el servicio no llego a runtime.started")), 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          let record: LogRecord;
          try { record = JSON.parse(line) as LogRecord; } catch { continue; }
          records.set(record.event, record);
          if (record.event === "runtime.started") { clearTimeout(timer); resolve(records); }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`el servicio termino antes de runtime.started: ${String(code)}`));
      });
    });
  } finally {
    child.kill("SIGKILL");
  }
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe("puesta en marcha de un equipo, con las herramientas reales", () => {
  it("publicar, firmar y arrancar deja el equipo aprovisionado", async () => {
    const records = await bootWithRealTools();

    const trust = records.get("security.session_trust");
    expect(trust, "no se emitio security.session_trust").toBeDefined();
    expect(trust?.fields).toMatchObject({ decision: "VALID", provisioned: 2 });

    const anchors = records.get("security.trust_anchors");
    expect(anchors, "no se emitio security.trust_anchors").toBeDefined();
    expect(anchors?.fields?.["usable"]).toBe("session_assertion=1 authorization_snapshot=1 license=0");

    const session = records.get("security.operator_session");
    expect(session, "no se emitio security.operator_session").toBeDefined();
    expect(session?.fields).toEqual({ decision: "PROVISIONED" });
  }, 120_000);
});
