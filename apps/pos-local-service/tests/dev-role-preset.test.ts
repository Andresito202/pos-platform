import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  SessionAssertionVerifier,
  SqliteTrustAnchorStore,
  TrustedClockGuard,
} from "../src/security/index.js";
import { SessionActivationService } from "../src/session/session-activation.js";
import { SqliteSessionAssertionStore } from "../src/session/sqlite-session-assertion-store.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import {
  activateDevRoleSession,
  provisionDevRoleTrustAnchors,
  PRESET_USER_ID,
  type DevSessionBinding,
} from "../src/dev-only/dev-session-bootstrap.js";
import { DEV_ROLE_PRESETS, type DevRolePresetId } from "../src/dev-only/dev-role-presets.js";
import { parseServiceConfig } from "../src/config.js";

/**
 * La sesión de revisión de pantallas por rol (`dev-only/`).
 *
 * Lo que se fija aquí:
 *
 *   1. `activateDevRoleSession` pasa por las rutas canónicas de verdad —
 *      `SessionActivationService.activate` y `authorizationStore.loadActive`
 *      devuelven exactamente lo que este módulo activó, no un doble.
 *   2. El snapshot activado lleva **exactamente** el reparto de permisos de
 *      `DEV_ROLE_PRESETS` para ese rol, ni más ni menos.
 *   3. `config.ts` rechaza `POS_DEV_ROLE_PRESET` junto con `PRODUCTION` o con
 *      un artefacto real configurado — las dos guardas de exclusión mutua.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO ES EXCLUSIVO DE TEST: se genera en memoria
 * dentro de `provisionDevRoleTrustAnchors` y no sustituye ningún ancla real.
 */

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close(); } catch { /* vacío */ } }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-dev-role-"));
  directories.push(value);
  return value;
}

const NOW = new Date("2026-09-26T12:00:00.000Z");
const BINDING: DevSessionBinding = {
  installationId: "018f0000-0000-7000-8000-0000000000e1",
  deviceId: "018f0000-0000-7000-8000-0000000000e2",
};

async function buildEnv() {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  databases.push(database);

  const trustAnchors = new SqliteTrustAnchorStore(database, () => NOW);
  const trustedClock = new TrustedClockGuard(database);

  // Orden deliberado: la provisión ocurre ANTES de construir el verificador
  // de sesión, exactamente como en `main.ts` — `SessionAssertionVerifier`
  // recibe el mapa de claves como una foto fija, no perezosa. Construirlo
  // antes de provisionar reproduciría el defecto de orden de arranque que
  // `dev-session-bootstrap.ts` documenta.
  const material = provisionDevRoleTrustAnchors(trustAnchors);

  const sessionActivation = new SessionActivationService(
    new SessionAssertionVerifier(trustAnchors.keysFor("SESSION_ASSERTION"), trustedClock, () => NOW),
    new SqliteSessionAssertionStore(database, () => NOW),
  );
  const authorizationStore = new SqliteAuthorizationSnapshotStore(database, () => NOW);

  return { database, trustAnchors, trustedClock, material, sessionActivation, authorizationStore };
}

describe("dev-only — sesión de revisión de pantallas por rol", () => {
  it.each(["CAJERO", "SUPERVISOR", "ADMIN"] as const)(
    "activa el preset %s por la ruta canónica y almacena exactamente su reparto",
    async (preset: DevRolePresetId) => {
      const { material, trustAnchors, sessionActivation, authorizationStore, trustedClock } = await buildEnv();

      const outcome = activateDevRoleSession(
        preset, BINDING, material, trustAnchors, sessionActivation, authorizationStore, trustedClock, () => NOW,
      );
      expect(outcome).toEqual({ kind: "PROVISIONED", preset });

      const stored = authorizationStore.loadActive({
        userId: PRESET_USER_ID[preset],
        installationId: BINDING.installationId,
        deviceId: BINDING.deviceId,
      });
      if (stored === null) throw new Error("el snapshot activado no se pudo leer de vuelta");

      const storedCodes = stored.claims.assignments[0]?.permissions.map((permission) => permission.code) ?? [];
      expect(new Set(storedCodes)).toEqual(new Set(DEV_ROLE_PRESETS[preset]));
    },
  );

  it("rechaza dos presets distintos como usuarios distintos, sin mezclar sus permisos", async () => {
    const { material, trustAnchors, sessionActivation, authorizationStore, trustedClock } = await buildEnv();

    activateDevRoleSession(
      "CAJERO", BINDING, material, trustAnchors, sessionActivation, authorizationStore, trustedClock, () => NOW,
    );
    const admin = activateDevRoleSession(
      "ADMIN", BINDING, material, trustAnchors, sessionActivation, authorizationStore, trustedClock, () => NOW,
    );
    expect(admin).toEqual({ kind: "PROVISIONED", preset: "ADMIN" });

    const cajeroSnapshot = authorizationStore.loadActive({
      userId: PRESET_USER_ID.CAJERO, installationId: BINDING.installationId, deviceId: BINDING.deviceId,
    });
    const adminSnapshot = authorizationStore.loadActive({
      userId: PRESET_USER_ID.ADMIN, installationId: BINDING.installationId, deviceId: BINDING.deviceId,
    });
    expect(cajeroSnapshot).not.toBeNull();
    expect(adminSnapshot).not.toBeNull();

    const cajeroCodes = new Set(cajeroSnapshot?.claims.assignments[0]?.permissions.map((permission) => permission.code));
    const adminCodes = new Set(adminSnapshot?.claims.assignments[0]?.permissions.map((permission) => permission.code));
    expect(cajeroCodes).toEqual(new Set(DEV_ROLE_PRESETS.CAJERO));
    expect(adminCodes).toEqual(new Set(DEV_ROLE_PRESETS.ADMIN));
    expect(adminCodes).not.toEqual(cajeroCodes);
  });

  it("sobrevive a un reinicio del servicio: el segundo arranque no es SEQUENCE_REPLAY", async () => {
    // Con `sequence: 1` fija, el segundo arranque sobre la misma base se
    // rechazaba y el equipo quedaba sin sesión tras reiniciar — visto al
    // arrancar `main.ts` dos veces sobre el mismo directorio de datos.
    const first = await buildEnv();
    expect(activateDevRoleSession(
      "ADMIN", BINDING, first.material, first.trustAnchors, first.sessionActivation,
      first.authorizationStore, first.trustedClock, () => NOW,
    )).toEqual({ kind: "PROVISIONED", preset: "ADMIN" });

    // Segundo arranque: mismo disco, claves efímeras nuevas, reloj posterior.
    const later = new Date(NOW.getTime() + 90_000);
    const material = provisionDevRoleTrustAnchors(first.trustAnchors);
    const sessionActivation = new SessionActivationService(
      new SessionAssertionVerifier(first.trustAnchors.keysFor("SESSION_ASSERTION"), first.trustedClock, () => later),
      new SqliteSessionAssertionStore(first.database, () => later),
    );
    expect(activateDevRoleSession(
      "ADMIN", BINDING, material, first.trustAnchors, sessionActivation,
      new SqliteAuthorizationSnapshotStore(first.database, () => later), first.trustedClock, () => later,
    )).toEqual({ kind: "PROVISIONED", preset: "ADMIN" });
  });
});

describe("dev-only — catálogo de repartos", () => {
  it("CAJERO es subconjunto estricto de SUPERVISOR, y SUPERVISOR de ADMIN", () => {
    const cajero = new Set(DEV_ROLE_PRESETS.CAJERO);
    const supervisor = new Set(DEV_ROLE_PRESETS.SUPERVISOR);
    const admin = new Set(DEV_ROLE_PRESETS.ADMIN);
    for (const code of cajero) expect(supervisor.has(code)).toBe(true);
    for (const code of supervisor) expect(admin.has(code)).toBe(true);
    expect(supervisor.size).toBeGreaterThan(cajero.size);
    expect(admin.size).toBeGreaterThan(supervisor.size);
  });
});

describe("dev-only — config.ts rechaza POS_DEV_ROLE_PRESET fuera de una revisión local", () => {
  function baseEnv(): NodeJS.ProcessEnv {
    return {
      POS_DATA_DIRECTORY: "/tmp/pos-dev-role-config",
      POS_INSTALLATION_ID: "018f0000-0000-7000-8000-0000000000f1",
      POS_DEVICE_ID: "018f0000-0000-7000-8000-0000000000f2",
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: "018f0000-0000-7000-8000-0000000000f3",
      POS_COMPANY_ID: "018f0000-0000-7000-8000-0000000000f4",
      POS_BRANCH_ID: "018f0000-0000-7000-8000-0000000000f5",
      POS_DEV_ROLE_PRESET: "ADMIN",
    };
  }

  it("acepta el preset a secas, sin entorno de confianza ni artefacto real", () => {
    expect(() => parseServiceConfig(baseEnv())).not.toThrow();
  });

  it("lo rechaza cuando el entorno de confianza es PRODUCTION", () => {
    expect(() => parseServiceConfig({
      ...baseEnv(),
      POS_SESSION_TRUST_ENVIRONMENT: "PRODUCTION",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: "-----BEGIN PUBLIC KEY-----\n".padEnd(90, "A"),
    })).toThrow(/PRODUCTION/);
  });

  it("lo rechaza junto con un artefacto real de sesión (`session_trust_artifact_path`)", () => {
    expect(() => parseServiceConfig({
      ...baseEnv(),
      POS_SESSION_TRUST_ARTIFACT_PATH: "/tmp/pos-dev-role-config/session-trust.json",
    })).toThrow(/session trust or operator session artifact/);
  });

  it("lo rechaza junto con un artefacto real de operador (`operator_session_artifact_path`)", () => {
    expect(() => parseServiceConfig({
      ...baseEnv(),
      POS_OPERATOR_SESSION_ARTIFACT_PATH: "/tmp/pos-dev-role-config/operator-session.json",
    })).toThrow(/session trust or operator session artifact/);
  });
});
