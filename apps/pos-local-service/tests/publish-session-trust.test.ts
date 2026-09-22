import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SessionAssertionTrustBundleSchema } from "@pos-platform/contracts";
import { SessionTrustKeyVerifier } from "../src/security/session-trust-key-verifier.js";

/**
 * El publicador del bundle de confianza — `G1.2`.
 *
 * ## Qué carencia cierra
 *
 * `SessionTrustKeyIssuer` existía como **clase dentro de `central-authority`**,
 * no como algo que el propietario pudiera ejecutar. Medido el 2026-09-22: no
 * había en todo el árbol una sola herramienta que produjera un bundle. El
 * paso 1 de la puesta en marcha de un equipo —el que `D-30` señala como el
 * bloqueo vigente— no tenía con qué hacerse.
 *
 * ## Por qué se verifica con el verificador del SERVICIO
 *
 * La herramienta reimplementa `canonicalSessionTrustJson` porque corre fuera
 * del workspace compilado, con `node` a secas. Comparar su firma contra otra
 * reimplementación mía no probaría nada: probaría que sé copiar un algoritmo.
 * Se ejecuta el binario de verdad, en un proceso aparte, y lo que verifica su
 * salida es `SessionTrustKeyVerifier`, que es el que corre en el equipo.
 */

const TOOL = fileURLToPath(new URL("../../../tools/provisioning/publish-session-trust.mjs", import.meta.url));
const NOW = new Date("2026-09-22T12:00:00.000Z");
const directories: string[] = [];

function workspace(): string {
  const created = mkdtempSync(join(tmpdir(), "publish-trust-"));
  directories.push(created);
  return created;
}

/**
 * Los argumentos se construyen desde un mapa, no concatenando al final.
 * `argument()` toma la PRIMERA ocurrencia, asi que un override anadido detras
 * no anula nada: la prueba pasaria sin probar el caso que dice probar.
 */
function publish(overrides: Readonly<Record<string, string>> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
  outDir: string;
  rootPublicPem: string;
} {
  const outDir = join(workspace(), "salida");
  const root = generateKeyPairSync("ed25519");
  const rootKeyPath = join(workspace(), "root.pem");
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(rootKeyPath, root.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "utf8");

  const args: Record<string, string> = {
    "root-key": rootKeyPath,
    "session-key-id": "SSA-2026-01",
    "snapshot-key-id": "SAS-2026-01",
    environment: "PRODUCTION",
    "out-dir": outDir,
    "valid-from": "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  const run = spawnSync(process.execPath, [
    TOOL,
    ...Object.entries(args).flatMap(([name, value]) => [`--${name}`, value]),
  ], { encoding: "utf8" });

  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    outDir,
    rootPublicPem: root.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe("publicacion del bundle de confianza", () => {
  it("produce un bundle que el verificador del servicio acepta, con las dos claves", () => {
    const { status, stderr, outDir, rootPublicPem } = publish();
    expect(status, stderr).toBe(0);

    const bundle = SessionAssertionTrustBundleSchema.parse(
      JSON.parse(readFileSync(join(outDir, "session-trust.json"), "utf8")),
    );
    expect(bundle.keys).toHaveLength(2);

    // La prueba real: lo verifica el verificador del equipo, no una copia.
    const verifier = new SessionTrustKeyVerifier(createPublicKey(rootPublicPem), "PRODUCTION", () => NOW);
    const decisions = bundle.keys.map((key) => verifier.verify(key));
    expect(decisions.map((d) => d.decision)).toEqual(["VALID", "VALID"]);
    expect(decisions.map((d) => d.claims?.key_purpose))
      .toEqual(["SESSION_ASSERTION", "AUTHORIZATION_SNAPSHOT"]);
  });

  /**
   * El par no puede desemparejarse porque se genera y se publica en el mismo
   * acto — pero eso hay que comprobarlo, que es justo el fallo que no avisa:
   * publicar la publica de un par y firmar con la privada de otro da
   * `SIGNATURE_INVALID` en el mostrador y en ningun sitio antes.
   */
  it("la clave privada que escribe corresponde a la publica que publica", () => {
    const { outDir } = publish();
    const bundle = SessionAssertionTrustBundleSchema.parse(
      JSON.parse(readFileSync(join(outDir, "session-trust.json"), "utf8")),
    );

    for (const [file, keyId] of [
      ["session-assertion-private.pem", "SSA-2026-01"],
      ["authorization-snapshot-private.pem", "SAS-2026-01"],
    ] as const) {
      const published = bundle.keys.find((key) => key.claims.key_id === keyId);
      expect(published, `no se publico ${keyId}`).toBeDefined();

      const { createPrivateKey, sign, verify } = require("node:crypto") as typeof import("node:crypto");
      const privateKey = createPrivateKey(readFileSync(join(outDir, file), "utf8"));
      const message = Buffer.from("prueba de correspondencia");
      const signature = sign(null, message, privateKey);
      expect(
        verify(null, message, createPublicKey(published!.claims.public_key_pem), signature),
        `${file} no corresponde con la clave publicada como ${keyId}`,
      ).toBe(true);
    }
  });

  it("no imprime ninguna clave", () => {
    const { stdout, outDir } = publish();
    expect(stdout).not.toContain("PRIVATE KEY");
    expect(stdout).not.toContain("PUBLIC KEY");
    expect(stdout).toContain("SSA-2026-01");
    expect(readFileSync(join(outDir, "session-assertion-private.pem"), "utf8")).toContain("PRIVATE KEY");
  });

  /**
   * `D-30` en una linea: es exactamente lo que trae el artefacto publicado en
   * su dia. Se rechaza aqui, donde se corrige escribiendo otra cosa, y no en
   * un equipo que responde `INVALID` sin decir por que.
   */
  it("rechaza codigos en minusculas, que es el defecto de D-30", () => {
    for (const bad of [
      { environment: "production" },
      { "session-key-id": "ssa-2026-01" },
      { "snapshot-key-id": "sas-2026-01" },
    ]) {
      const { status, stderr } = publish(bad);
      expect(status, `se acepto ${JSON.stringify(bad)}`).not.toBe(0);
      expect(stderr).toContain("MAYUSCULAS");
    }
  });

  it("rechaza dos identificadores iguales, que el bundle no admite", () => {
    const { status, stderr } = publish({ "snapshot-key-id": "SSA-2026-01" });
    expect(status).not.toBe(0);
    expect(stderr).toContain("distintos");
  });
});
