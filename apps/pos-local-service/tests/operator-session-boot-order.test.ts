import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AuthorizationSnapshotClaimsSchema,
  SessionAssertionClaimsSchema,
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
import { canonicalJson } from "../src/channel/canonical-json.js";
import { unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";

/**
 * El orden de arranque que `DEC-025` necesita, medido arrancando el servicio.
 *
 * ## El defecto que fija
 *
 * La provision del ancla de confianza estaba escrita **despues** de
 * `lifecycle.start()`. `CommercialComponent` resuelve su mapa de claves una
 * sola vez, dentro de su propio `start()` —ceremonia deliberada: rotar un ancla
 * exige reiniciar—, asi que el verificador de SSA se quedaba con el mapa
 * **vacio de antes de provisionar**. Una `key_id` que no esta en el mapa se
 * reporta como `SIGNATURE_INVALID`, por diseno, para no revelar que claves
 * existen.
 *
 * Resultado medido el 2026-09-20, con artefacto y firma correctos:
 *
 *   primer arranque  → `SESSION_REJECTED` / `SIGNATURE_INVALID`
 *   segundo arranque → pasa la SSA (la fila ya estaba en la tabla)
 *
 * Es decir, **el unico arranque que no podia funcionar era justo aquel para el
 * que se escribio `DEC-025`**: el de un equipo recien aprovisionado. No lo
 * cazo ninguna prueba porque la unica que arranca el runtime de verdad
 * (`session-bootstrap-main-runtime.test.ts`) esta `skipIf` de Windows y CI
 * corre en Linux.
 *
 * ## Que afirma, y que no
 *
 * Afirma que en el PRIMER arranque la SSA se activa: el desenlace ya no es
 * `SESSION_REJECTED`. **No** afirma que el aprovisionamiento se complete: hoy
 * se detiene en el snapshot porque el ancla no tiene clave de proposito
 * `AUTHORIZATION_SNAPSHOT` —el contrato del bundle no admite publicarla— y eso
 * es una carencia registrada, no algo que esta prueba deba dar por bueno.
 *
 * Por eso la asercion es sobre el paso alcanzado y no sobre un desenlace
 * concreto: cuando esa carencia se cierre, esta prueba seguira siendo cierta
 * sin reescribirse. Lo que no admite es que la linea desaparezca: se exige
 * primero que el evento exista.
 */

const IDS = {
  installationId: "018f0000-0000-7000-8000-0000000000a2",
  deviceId: "018f0000-0000-7000-8000-0000000000a3",
  userId: "018f0000-0000-7000-8000-0000000000a1",
  tenantId: "018f0000-0000-7000-8000-0000000000a4",
  companyId: "018f0000-0000-7000-8000-0000000000a5",
  branchId: "018f0000-0000-7000-8000-0000000000a6",
} as const;

const SSA_KEY_ID = "SSA-BOOT-ORDER-01";
const SAS_KEY_ID = "SAS-BOOT-ORDER-01";

interface LogRecord {
  readonly event: string;
  readonly fields?: Record<string, unknown>;
}

function signed<T>(claims: T, bytes: Buffer, key: ReturnType<typeof generateKeyPairSync>): {
  claims: T;
  signature: string;
} {
  return { claims, signature: sign(null, bytes, key.privateKey).toString("base64url") };
}

function writeMaterial(directory: string): { trustPath: string; artifactPath: string; rootPem: string } {
  const root = generateKeyPairSync("ed25519");
  // Una clave por proposito (`D-31`). Firmar identidad y firmar permisos son
  // dominios distintos: compartir clave haria que quien pudiera emitir una
  // pudiera emitir la otra, y revocar una obligase a revocar ambas.
  const sessionKey = generateKeyPairSync("ed25519");
  const snapshotKey = generateKeyPairSync("ed25519");

  // `environment` y `key_id` son `StableCodeSchema`: mayusculas. El artefacto
  // publicado por `G1.2` usa minusculas y por eso no parsea — `D-30`, aparte;
  // aqui se genera material que el contrato admite.
  const publish = (keyId: string, purpose: string, key: ReturnType<typeof generateKeyPairSync>) => {
    const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
      key_id: keyId,
      key_purpose: purpose,
      environment: "PRODUCTION",
      public_key_pem: key.publicKey.export({ type: "spki", format: "pem" }),
      status: "ACTIVE",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: null,
      version: 1,
    });
    return signed(claims, unsignedSessionAssertionOperationalKeyBytes(claims), root);
  };

  const trustPath = join(directory, "session-trust.json");
  writeFileSync(trustPath, JSON.stringify(SessionAssertionTrustBundleSchema.parse({
    version: 1,
    keys: [
      publish(SSA_KEY_ID, "SESSION_ASSERTION", sessionKey),
      publish(SAS_KEY_ID, "AUTHORIZATION_SNAPSHOT", snapshotKey),
    ],
  })));

  // Vigencia relativa al reloj real: el servicio arranca ahora y una SSA
  // vencida se rechazaria por `EXPIRED`, que no es lo que se mide aqui.
  const now = Date.now();
  const at = (ms: number): string => new Date(now + ms).toISOString();

  const sessionClaims = SessionAssertionClaimsSchema.parse({
    session_id: "018f0000-0000-7000-8000-0000000000b0",
    user_id: IDS.userId,
    tenant_membership_id: "018f0000-0000-7000-8000-0000000000b1",
    installation_id: IDS.installationId,
    device_id: IDS.deviceId,
    issued_at: at(-60_000),
    offline_valid_until: at(6 * 3_600_000),
    sequence: 1,
    key_id: SSA_KEY_ID,
  });
  const snapshotClaims = AuthorizationSnapshotClaimsSchema.parse({
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
    key_id: SAS_KEY_ID,
  });

  const artifactPath = join(directory, "operator-session.json");
  writeFileSync(artifactPath, JSON.stringify({
    version: 1,
    session_assertion: signed(sessionClaims, unsignedSessionAssertionBytes(sessionClaims), sessionKey),
    authorization_snapshot: signed(
      snapshotClaims, Buffer.from(canonicalJson(snapshotClaims)), snapshotKey,
    ),
  }));

  return {
    trustPath,
    artifactPath,
    rootPem: root.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function bootOnce(directory: string): Promise<Map<string, LogRecord>> {
  const { trustPath, artifactPath, rootPem } = writeMaterial(directory);
  const child = spawn(process.execPath, [
    join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs"), "src/main.ts",
  ], {
    cwd: join(__dirname, ".."),
    env: {
      ...process.env,
      // Sin esto `main.ts` exige Windows. Es el mismo interruptor que usa el
      // resto de la suite para arrancar el runtime fuera de un mostrador.
      NODE_ENV: "test",
      POS_DATA_DIRECTORY: join(directory, "data"),
      POS_INSTALLATION_ID: IDS.installationId,
      POS_DEVICE_ID: IDS.deviceId,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: IDS.tenantId,
      POS_COMPANY_ID: IDS.companyId,
      POS_BRANCH_ID: IDS.branchId,
      POS_SESSION_TRUST_ENVIRONMENT: "PRODUCTION",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPem,
      POS_SESSION_TRUST_ARTIFACT_PATH: trustPath,
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
          try {
            record = JSON.parse(line) as LogRecord;
          } catch {
            continue;
          }
          records.set(record.event, record);
          if (record.event === "runtime.started") {
            clearTimeout(timer);
            resolve(records);
          }
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

describe("DEC-025 — aprovisionamiento de sesion en el arranque", () => {
  it("aprovisiona la sesion del operador en el PRIMER arranque", async () => {
    const directory = mkdtempSync(join(tmpdir(), "boot-order-"));
    try {
      const records = await bootOnce(directory);

      // Primero que las lineas existan: una asercion sobre un evento ausente
      // pasaria en silencio, que es justo el modo de fallo que se persigue.
      const trust = records.get("security.session_trust");
      expect(trust, "el arranque no emitio security.session_trust").toBeDefined();
      expect(trust?.fields).toMatchObject({ decision: "VALID", provisioned: 2 });

      // `D-31`: las DOS anclas pobladas. Con el contrato anterior —un solo
      // proposito posible— esta linea decia `authorization_snapshot=0` con
      // material impecable, y no habia ninguna ruta para cambiarlo.
      //
      // `D-32`: y estan pobladas ANTES de que `commercial` resuelva su mapa,
      // que es lo que hace que el PRIMER arranque valga. Si la provision
      // vuelve a quedar detras de `lifecycle.start()`, la SSA se rechaza.
      const anchors = records.get("security.trust_anchors");
      expect(anchors, "el arranque no emitio security.trust_anchors").toBeDefined();
      expect(anchors?.fields?.["usable"]).toBe(
        "session_assertion=1 authorization_snapshot=1 license=0",
      );

      // El desenlace completo: los dos sobres verificados y aplicados por las
      // rutas canonicas (`SSA-002` y `SAS-003`). Es la invariante `D1` de
      // `DEC-025` —«los dos sobres, o ninguno»— cumplida de extremo a extremo.
      const session = records.get("security.operator_session");
      expect(session, "el arranque no emitio security.operator_session").toBeDefined();
      expect(session?.fields).toEqual({ decision: "PROVISIONED" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
