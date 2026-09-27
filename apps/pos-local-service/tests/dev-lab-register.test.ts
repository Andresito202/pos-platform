import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { SignedMasterSnapshotSchema } from "@pos-platform/contracts";
import { activateDevLabRegister, DEV_LAB_REGISTER_ID } from "../src/dev-only/dev-lab-register.js";
import { SqliteMasterSnapshotStore } from "../src/master-data/sqlite-master-snapshot-store.js";
import { TrustedClockGuard } from "../src/security/trusted-clock.js";
import { DEV_ROLE_PRESETS } from "../src/dev-only/dev-role-presets.js";

/**
 * Caja de laboratorio (`dev-only/dev-lab-register.ts`).
 *
 * Lo que se fija: la caja entra por la ruta canónica de `DEC-013` —el
 * artefacto queda en el libro con una firma Ed25519 real, no con el relleno
 * `stub-sig` de los arneses— y la proyección que lee `cash.shift.open` la ve.
 */

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close(); } catch { /* vacío */ } }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function open(): Promise<LocalDatabase> {
  const directory = await mkdtemp(join(tmpdir(), "pos-dev-lab-register-"));
  directories.push(directory);
  const database = LocalDatabase.open({ dataDirectory: directory });
  databases.push(database);
  return database;
}

const SCOPE = {
  tenantId: "00000000-0000-7000-8000-0000000000d1",
  companyId: "2e7696f3-1831-403c-a9a4-d683eec298e7",
  branchId: "69832fae-64e2-4ad9-917f-554fed568f31",
};
const NOW = () => new Date("2026-09-27T17:00:00.000Z");

describe("dev-only — caja de laboratorio por la ruta canónica del snapshot maestro", () => {
  it("activa la caja y la proyección de apertura de turno la ve activa", async () => {
    const database = await open();
    const outcome = activateDevLabRegister(database, new TrustedClockGuard(database), SCOPE, NOW);
    expect(outcome).toEqual({ kind: "ACTIVATED", sequence: 1, registerId: DEV_LAB_REGISTER_ID });

    const store = new SqliteMasterSnapshotStore(database, NOW);
    expect(store.highestAcceptedSequence(SCOPE)).toBe(1);
    expect(store.activeRegisters(SCOPE)).toEqual([
      expect.objectContaining({ id: DEV_LAB_REGISTER_ID, status: "ACTIVE", currency_code: "COP" }),
    ]);
  });

  it("deja en el libro un artefacto con firma real, no el relleno de los arneses", async () => {
    const database = await open();
    activateDevLabRegister(database, new TrustedClockGuard(database), SCOPE, NOW);
    const row = database.native.prepare(
      "SELECT claims_json, signature, key_id, environment FROM local_master_snapshot_artifact",
    ).get() as { claims_json: string; signature: string; key_id: string; environment: string };
    expect(row.key_id).toBe("DEV-LOCAL-MASTER");
    expect(row.environment).toBe("SANDBOX");
    expect(SignedMasterSnapshotSchema.safeParse({ claims: JSON.parse(row.claims_json), signature: row.signature }).success).toBe(true);
  });

  it("no reemite en cada arranque: una vez aceptada, la caja persiste", async () => {
    const database = await open();
    const clock = new TrustedClockGuard(database);
    activateDevLabRegister(database, clock, SCOPE, NOW);
    expect(activateDevLabRegister(database, clock, SCOPE, NOW)).toEqual({
      kind: "ALREADY_PRESENT", registerId: DEV_LAB_REGISTER_ID,
    });
    expect(database.native.prepare("SELECT COUNT(*) AS n FROM local_master_snapshot_artifact").get()).toEqual({ n: 1 });
  });

  it("el preset ADMIN puede abrir el turno de esa caja", () => {
    expect(DEV_ROLE_PRESETS.ADMIN).toContain("CASH_SHIFT_OPEN");
  });
});
