import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionClaims,
} from "@pos-platform/contracts";
// `unsignedSessionAssertionBytes` vive en el servicio, no en el contrato: el
// import original apuntaba a `@pos-platform/contracts`, donde nunca existio.
import { unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";
import { LocalChannelAuthenticator, LocalChannelClient } from "@pos-platform/local-channel";
import { StructuredLogger, type LogRecord } from "@pos-platform/observability";
import { loadOrCreateWindowsLocalChannelSecret } from "../src/channel/secret.js";

/**
 * El entorno de confianza, **escrito una sola vez**.
 *
 * Se comparaba en dos sitios con dos literales distintos: el claim firmado lo
 * llevaba en minusculas y la configuracion del proceso tambien, de modo que
 * coincidian entre si pero **ninguno cumplia el contrato**. Con una sola
 * constante, la divergencia deja de ser posible; con dos, sigue dependiendo de
 * que alguien se acuerde.
 */
const TRUST_ENVIRONMENT = "PRODUCTION";

const IDS = {
  installationId: "018f0000-0000-7000-8000-0000000000a2",
  deviceId: "018f0000-0000-7000-8000-0000000000a3",
  userId: "018f0000-0000-7000-8000-0000000000a1",
  tenantId: "018f0000-0000-7000-8000-0000000000a4",
  companyId: "018f0000-0000-7000-8000-0000000000a5",
  branchId: "018f0000-0000-7000-8000-0000000000a6",
};

function sessionAssertion(operational: ReturnType<typeof generateKeyPairSync>): {
  claims: SessionAssertionClaims;
  signature: string;
} {
  const claims: SessionAssertionClaims = {
    session_id: "018f0000-0000-7000-8000-0000000000b0",
    user_id: IDS.userId,
    tenant_membership_id: "018f0000-0000-7000-8000-0000000000b1",
    installation_id: IDS.installationId,
    device_id: IDS.deviceId,
    // Vigencia **relativa al reloj real**. Estuvo fijada al 17/18 de
    // septiembre de 2026, asi que a partir del dia 18 la SSA entraba vencida
    // y `session.activate` respondia `EXPIRED`: la prueba caducaba sola.
    // Una prueba con fecha de caducidad es una prueba que un dia miente.
    issued_at: new Date(Date.now() - 60_000).toISOString(),
    offline_valid_until: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    sequence: 1,
    key_id: "SSA-RUNTIME-01",
  };
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionBytes(claims), operational.privateKey).toString("base64url"),
  };
}

function trustArtifact(root: ReturnType<typeof generateKeyPairSync>, operational: ReturnType<typeof generateKeyPairSync>, version: number, status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED") {
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: "SSA-RUNTIME-01",
    key_purpose: "SESSION_ASSERTION",
    // `StableCodeSchema`: mayusculas. Estuvo en minusculas y **este
    // `parse` lanzaba**, de modo que la prueba no podia pasar ni en Windows.
    // Es el mismo defecto que tiene el artefacto publicado por `G1.2`
    // (`D-30`): nadie lo vio porque esta suite es `skipIf` de Windows y CI
    // corre en Linux.
    environment: TRUST_ENVIRONMENT,
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
    status,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  });
  return SessionAssertionTrustBundleSchema.parse({
    version,
    keys: [{
      claims,
      signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url"),
    }],
  });
}

async function waitForRuntime(child: ChildProcessWithoutNullStreams): Promise<{ endpoint: string; sessionTrust: string }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("POS Local Service did not reach runtime.started")), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (const line of buffer.split("\n")) {
        if (!line.includes("runtime.started")) continue;
        try {
          // El logger estructurado emite `event`, no `message`. Leyendo
          // `message` esta espera no casaba **nunca** y la prueba moria a los
          // 30 s por tiempo agotado, dijera lo que dijera el servicio.
          const record = JSON.parse(line) as {
            event?: string;
            fields?: { local_channel_endpoint?: string; session_trust?: string };
          };
          if (record.event !== "runtime.started" || record.fields?.local_channel_endpoint === undefined) continue;
          clearTimeout(timer);
          resolve({
            endpoint: record.fields.local_channel_endpoint,
            sessionTrust: record.fields.session_trust ?? "",
          });
          return;
        } catch {
          // Continue buffering until the structured logger emits a complete line.
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`POS Local Service exited before runtime.started: ${String(code)}`));
    });
  });
}

function spawnService(serviceRoot: string, dataDirectory: string, rootPublicKeyPem: string, artifactPath: string): ChildProcessWithoutNullStreams {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return spawn(command, ["exec", "tsx", "src/main.ts"], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      POS_DATA_DIRECTORY: dataDirectory,
      POS_INSTALLATION_ID: IDS.installationId,
      POS_DEVICE_ID: IDS.deviceId,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: IDS.tenantId,
      POS_COMPANY_ID: IDS.companyId,
      POS_BRANCH_ID: IDS.branchId,
      POS_SESSION_TRUST_ENVIRONMENT: TRUST_ENVIRONMENT,
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_ARTIFACT_PATH: artifactPath,
    },
  }) as ChildProcessWithoutNullStreams;
}

/**
 * Lo que se puede comprobar **sin un named pipe**, y por tanto en CI.
 *
 * La suite de abajo es `skipIf` de Windows porque el canal local solo existe
 * ahi. Eso dejo tres defectos vivos en sus propios fixtures durante semanas:
 * un `environment` que el contrato rechaza, una espera que leia un campo que
 * el logger no emite, y una vigencia fija que caducaba sola. Ninguno necesita
 * Windows para detectarse — solo necesitaba que alguien los mirara.
 *
 * Esto los mira en cada ejecucion de CI. No sustituye a la prueba de Windows:
 * evita que el propietario descubra en el mostrador que el material de prueba
 * nunca fue valido.
 */
describe("G1.2 — los fixtures de la prueba de Windows", () => {
  it("producen un bundle que el contrato acepta", () => {
    const root = generateKeyPairSync("ed25519");
    const operational = generateKeyPairSync("ed25519");
    // `trustArtifact` parsea con los esquemas reales por dentro: si el
    // fixture no cumple el contrato, esto lanza.
    const bundle = trustArtifact(root, operational, 1, "ACTIVE");
    expect(bundle.keys[0]?.claims.environment).toBe(TRUST_ENVIRONMENT);
  });

  /**
   * El tercer defecto no estaba en un fixture sino en la espera: leia
   * `record.message` y el logger emite `event`, de modo que la condicion no
   * casaba **nunca** y la prueba moria a los 30 s por tiempo agotado, dijera
   * lo que dijera el servicio. Un tiempo agotado no dice por que.
   *
   * No se compara contra una forma escrita a mano —eso seria volver a
   * suponer—: se emite por el logger de verdad y se mira que sale.
   */
  it("esperan el campo que el logger emite de verdad", async () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger({ write: (record) => { records.push(record); } });
    logger.log("info", "runtime.started", { local_channel_endpoint: "\\\\.\\pipe\\x" });
    await logger.flush();

    const [record] = records;
    expect(record?.event).toBe("runtime.started");
    expect(record).not.toHaveProperty("message");
  });

  it("producen una SSA vigente ahora, no en una fecha que ya paso", () => {
    const operational = generateKeyPairSync("ed25519");
    const { claims } = sessionAssertion(operational);
    const now = Date.now();

    expect(Date.parse(claims.issued_at)).toBeLessThanOrEqual(now);
    // Vigencia semiabierta: en el instante exacto de expiracion ya no vale.
    expect(Date.parse(claims.offline_valid_until)).toBeGreaterThan(now);
    // Y dentro del techo de 24 h de `DEC-012` §19.
    expect(Date.parse(claims.offline_valid_until) - Date.parse(claims.issued_at))
      .toBeLessThanOrEqual(24 * 3_600_000);
  });
});

describe.skipIf(process.platform !== "win32")("G1.2 main runtime bootstrap", () => {
  it("boots the real service, activates through the real named pipe, recovers after restart and honors trust revocation", async () => {
    const root = generateKeyPairSync("ed25519");
    const operational = generateKeyPairSync("ed25519");
    const dataDirectory = mkdtempSync(join(process.env.TEMP ?? process.cwd(), "camacho-g12-runtime-"));
    const artifactPath = join(dataDirectory, "session-trust.json");
    const serviceRoot = join(import.meta.dirname, "..");
    const channelSecret = loadOrCreateWindowsLocalChannelSecret(dataDirectory, IDS.installationId);
    const clientAuthenticator = new LocalChannelAuthenticator(channelSecret);
    channelSecret.fill(0);
    let service: ChildProcessWithoutNullStreams | undefined;
    let client: LocalChannelClient | undefined;

    try {
      writeFileSync(artifactPath, JSON.stringify(trustArtifact(root, operational, 1, "ACTIVE")), "utf8");
      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const ready = await waitForRuntime(service);
      expect(ready.sessionTrust).toBe("VALID");

      client = new LocalChannelClient(ready.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });

      const assertion = sessionAssertion(operational);
      const activate = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.activate",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { session_assertion: assertion },
      }) as { status: string };
      expect(activate.status).toBe("SUCCEEDED");

      await client.close();
      const stopped = new Promise<void>((resolve) => service!.once("exit", () => resolve()));
      service.kill("SIGTERM");
      await stopped;
      service = undefined;

      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const restarted = await waitForRuntime(service);
      expect(restarted.sessionTrust).toBe("VALID");
      client = new LocalChannelClient(restarted.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });

      const recovered = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.recover",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {},
      }) as { status: string };
      expect(recovered.status).toBe("SUCCEEDED");

      await client.close();
      const stoppedAgain = new Promise<void>((resolve) => service!.once("exit", () => resolve()));
      service.kill("SIGTERM");
      await stoppedAgain;
      service = undefined;

      writeFileSync(artifactPath, JSON.stringify(trustArtifact(root, operational, 2, "REVOKED")), "utf8");
      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const revoked = await waitForRuntime(service);
      expect(revoked.sessionTrust).toBe("INVALID");

      client = new LocalChannelClient(revoked.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });
      const rejected = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.activate",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { session_assertion: assertion },
      }) as { status: string };
      expect(rejected.status).toBe("REJECTED");
    } finally {
      await client?.close().catch(() => undefined);
      if (service !== undefined && service.exitCode === null) service.kill("SIGTERM");
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
