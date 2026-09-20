import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../src/channel/canonical-json.js";
import { unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";
import { unsignedAuthorizationSnapshotBytes } from "../src/security/authorization-snapshot-verifier.js";
import {
  ArtifactSnapshotProvider,
  readOperatorSessionArtifact,
} from "../src/session/operator-session-artifact.js";

/**
 * `DEC-025` — el artefacto de aprovisionamiento de sesión.
 *
 * Lo que se fija aquí es la **forma** y el fallo cerrado de la lectura. La
 * confianza la dan los verificadores contra `local_trust_anchor`, que tienen
 * sus propias pruebas; este módulo no la sustituye y estas pruebas no fingen
 * que lo haga.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO ES EXCLUSIVO DE TEST: se genera en memoria y
 * no sustituye a la clave operacional real.
 */

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close(); } catch { /* vacío */ } }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), "pos-provision-"));
  directories.push(value);
  return value;
}

const KEY = generateKeyPairSync("ed25519");
const USER = "018f0000-0000-7000-8000-0000000f0001";
const INSTALLATION = "018f0000-0000-7000-8000-0000000f0002";
const DEVICE = "018f0000-0000-7000-8000-0000000f0003";

function signed(claims: Record<string, unknown>): { claims: unknown; signature: string } {
  return {
    claims,
    signature: sign(null, Buffer.from(canonicalJson(claims)), KEY.privateKey).toString("base64url"),
  };
}

function sessionClaims(): Record<string, unknown> {
  return {
    session_id: "018f0000-0000-7000-8000-0000000f0010",
    user_id: USER,
    tenant_membership_id: "018f0000-0000-7000-8000-0000000f0011",
    installation_id: INSTALLATION,
    device_id: DEVICE,
    issued_at: "2026-09-20T00:00:00.000Z",
    offline_valid_until: "2026-09-20T12:00:00.000Z",
    sequence: 1,
    key_id: "SESSION_KEY_1",
  };
}

function snapshotClaims(): Record<string, unknown> {
  return {
    snapshot_id: "018f0000-0000-7000-8000-0000000f0020",
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-20T00:00:00.000Z",
    expires_at: "2026-09-21T00:00:00.000Z",
    assignments: [],
    key_id: "AUTHZ_KEY_1",
  };
}

function writeArtifact(body: unknown): string {
  const path = join(directory(), "operator-session.json");
  writeFileSync(path, JSON.stringify(body), "utf8");
  return path;
}

describe("DEC-025 — lectura del artefacto de aprovisionamiento", () => {
  it("lee un artefacto bien formado con los dos sobres", () => {
    const path = writeArtifact({
      version: 1,
      session_assertion: signed(sessionClaims()),
      authorization_snapshot: signed(snapshotClaims()),
    });
    const read = readOperatorSessionArtifact(path);
    expect(read.decision).toBe("PRESENT");
  });

  /**
   * Un equipo sin aprovisionar es un estado normal, no un error. Confundirlo
   * con un fichero manipulado haría que borrarlo pareciera un ataque, y que un
   * ataque pareciera un equipo nuevo.
   */
  it("un fichero ausente es ABSENT, no INVALID", () => {
    expect(readOperatorSessionArtifact(join(directory(), "no-existe.json")).decision)
      .toBe("ABSENT");
  });

  it("un JSON roto o una forma inesperada son INVALID, con motivo distinto", () => {
    const broken = join(directory(), "roto.json");
    writeFileSync(broken, "{no es json", "utf8");
    const brokenRead = readOperatorSessionArtifact(broken);
    expect(brokenRead).toEqual({ decision: "INVALID", reason: "ARTIFACT_NOT_JSON" });

    const shaped = readOperatorSessionArtifact(writeArtifact({ version: 1 }));
    expect(shaped).toEqual({ decision: "INVALID", reason: "ARTIFACT_SHAPE_INVALID" });
  });

  /**
   * El invariante de `DEC-025` D1: los dos sobres o ninguno. Sólo la SSA daría
   * una sesión válida sin un permiso, y el POS arrancaría para rechazarlo todo.
   */
  it("un artefacto con sólo la sesión no se acepta", () => {
    const read = readOperatorSessionArtifact(writeArtifact({
      version: 1, session_assertion: signed(sessionClaims()),
    }));
    expect(read).toEqual({ decision: "INVALID", reason: "ARTIFACT_SHAPE_INVALID" });
  });

  it("no filtra el contenido del artefacto en el motivo", () => {
    const read = readOperatorSessionArtifact(writeArtifact({
      version: 1,
      session_assertion: signed({ ...sessionClaims(), user_id: "no-es-uuid" }),
      authorization_snapshot: signed(snapshotClaims()),
    }));
    expect(read.decision).toBe("INVALID");
    // El motivo es un código estable, nunca el detalle del parseo.
    expect(JSON.stringify(read)).not.toContain("no-es-uuid");
  });

  it("el proveedor sirve el snapshot del artefacto por el seam de SAS-003", async () => {
    const path = writeArtifact({
      version: 1,
      session_assertion: signed(sessionClaims()),
      authorization_snapshot: signed(snapshotClaims()),
    });
    const read = readOperatorSessionArtifact(path);
    if (read.decision !== "PRESENT") throw new Error("artefacto no legible");

    const provider = new ArtifactSnapshotProvider(read.artifact);
    const fetched = await provider.fetch({
      userId: USER, installationId: INSTALLATION, deviceId: DEVICE,
    });
    expect(fetched).toEqual(read.artifact.authorization_snapshot);
  });
});

/**
 * La serialización del firmador y la del servicio tienen que coincidir.
 *
 * El firmador corre fuera del workspace compilado, con `node` a secas, así que
 * reimplementa `canonicalJson`. Si las dos divergieran la firma no verificaría,
 * y el fallo aparecería en un mostrador en vez de en CI.
 *
 * Por eso la prueba **ejecuta el firmador de verdad** y verifica su firma con
 * los bytes canónicos del servicio. Comparar dos reimplementaciones mías no
 * probaría nada: probaría que sé copiar un algoritmo.
 */
describe("DEC-025 — el firmador produce firmas que el servicio verifica", () => {
  it("firma una SSA y un SAS que verifican con los bytes canónicos del servicio", () => {
    const workspace = directory();
    // Dos claves distintas (`D-31`): identidad y permisos son dominios
    // criptograficos separados y el equipo los verifica contra anclas
    // distintas. Usar la misma aqui haria pasar la prueba aunque el firmador
    // volviese a firmar los dos sobres con una sola.
    const snapshotKeyPair = generateKeyPairSync("ed25519");
    const sessionKeyPath = join(workspace, "session.pem");
    const snapshotKeyPath = join(workspace, "snapshot.pem");
    writeFileSync(
      sessionKeyPath,
      KEY.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "utf8",
    );
    writeFileSync(
      snapshotKeyPath,
      snapshotKeyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "utf8",
    );

    // Sin `key_id`: lo pone el firmador, que es lo que ata cada sobre a una
    // clave concreta del ancla.
    const { key_id: _sessionKey, ...sessionInput } = sessionClaims();
    const { key_id: _snapshotKey, ...snapshotInput } = snapshotClaims();
    const inputPath = join(workspace, "input.json");
    writeFileSync(inputPath, JSON.stringify({
      session_assertion: sessionInput,
      authorization_snapshot: snapshotInput,
    }), "utf8");

    const outputPath = join(workspace, "artifact.json");
    const signer = join(
      fileURLToPath(new URL("../../../tools/provisioning/sign-operator-session.mjs", import.meta.url)),
    );
    const run = spawnSync(process.execPath, [
      signer,
      "--session-key", sessionKeyPath,
      "--session-key-id", "SESSION_KEY_1",
      "--snapshot-key", snapshotKeyPath,
      "--snapshot-key-id", "SNAPSHOT_KEY_1",
      "--input", inputPath,
      "--output", outputPath,
    ], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    // Nunca la clave ni los claims en la salida: sólo para quién se firmó.
    expect(run.stdout).toContain(USER);
    expect(run.stdout).not.toContain("PRIVATE KEY");

    const read = readOperatorSessionArtifact(outputPath);
    if (read.decision !== "PRESENT") throw new Error(`artefacto ilegible: ${JSON.stringify(read)}`);

    // La prueba real: los bytes que el SERVICIO considera firmados verifican
    // contra la firma que produjo el FIRMADOR.
    expect(verify(
      null,
      unsignedSessionAssertionBytes(read.artifact.session_assertion.claims),
      KEY.publicKey,
      Buffer.from(read.artifact.session_assertion.signature, "base64url"),
    )).toBe(true);

    expect(verify(
      null,
      unsignedAuthorizationSnapshotBytes(read.artifact.authorization_snapshot.claims),
      snapshotKeyPair.publicKey,
      Buffer.from(read.artifact.authorization_snapshot.signature, "base64url"),
    )).toBe(true);

    // Y **cada sobre con SU clave**: cruzarlas no verifica. Sin esto, firmar
    // ambos con una sola clave seguiria pasando las dos aserciones de arriba.
    expect(verify(
      null,
      unsignedAuthorizationSnapshotBytes(read.artifact.authorization_snapshot.claims),
      KEY.publicKey,
      Buffer.from(read.artifact.authorization_snapshot.signature, "base64url"),
    )).toBe(false);

    expect(read.artifact.session_assertion.claims.key_id).toBe("SESSION_KEY_1");
    expect(read.artifact.authorization_snapshot.claims.key_id).toBe("SNAPSHOT_KEY_1");
  });

  /** `DEC-025` D3.3: el binding tiene que ser el mismo en los dos sobres. */
  it("rechaza firmar cuando el binding de los dos sobres no coincide", () => {
    const workspace = directory();
    const privateKeyPath = join(workspace, "operational.pem");
    writeFileSync(
      privateKeyPath,
      KEY.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "utf8",
    );
    const inputPath = join(workspace, "input.json");
    writeFileSync(inputPath, JSON.stringify({
      session_assertion: sessionClaims(),
      authorization_snapshot: {
        ...snapshotClaims(),
        device_id: "018f0000-0000-7000-8000-0000000f00ff",
      },
    }), "utf8");

    const run = spawnSync(process.execPath, [
      fileURLToPath(new URL("../../../tools/provisioning/sign-operator-session.mjs", import.meta.url)),
      "--session-key", privateKeyPath, "--session-key-id", "SESSION_KEY_1",
      "--snapshot-key", privateKeyPath, "--snapshot-key-id", "SNAPSHOT_KEY_1",
      "--input", inputPath, "--output", join(workspace, "artifact.json"),
    ], { encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("binding incoherente");
  });
});
