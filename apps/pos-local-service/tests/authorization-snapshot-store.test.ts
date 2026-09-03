import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import {
  SqliteAuthorizationSnapshotStore,
  unsignedAuthorizationSnapshotBytes,
} from "../src/index.js";

/** Material criptográfico exclusivo de test; ver SAS-001. */
const testOnlyKeyPair = generateKeyPairSync("ed25519");

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-authz-store-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const SNAPSHOT = "018f0000-0000-7000-8000-0000000000a0";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";
const OTHER = "018f0000-0000-7000-8000-0000000000ff";

const BINDING = { userId: USER, installationId: INSTALLATION, deviceId: DEVICE };
const INSIDE_WINDOW = new Date("2026-09-03T12:00:00Z");

function claims(overrides: Partial<AuthorizationSnapshotClaims> = {}): AuthorizationSnapshotClaims {
  return {
    snapshot_id: SNAPSHOT,
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-03T00:00:00Z",
    expires_at: "2026-09-04T00:00:00Z",
    assignments: [
      {
        tenant_id: TENANT,
        company_id: COMPANY,
        branch_id: BRANCH,
        status: "ACTIVE",
        valid_from: "2026-09-01T00:00:00Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: [{ code: "CASH_SHIFT_OPEN", status: "ACTIVE" }],
      },
    ],
    key_id: "AUTHZ_KEY_1",
    ...overrides,
  } as AuthorizationSnapshotClaims;
}

function signed(value: AuthorizationSnapshotClaims) {
  return {
    claims: value,
    signature: sign(null, unsignedAuthorizationSnapshotBytes(value), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

async function withStore<T>(
  now: Date,
  run: (store: SqliteAuthorizationSnapshotStore, database: LocalDatabase) => T,
): Promise<T> {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  try {
    return run(new SqliteAuthorizationSnapshotStore(database, () => now), database);
  } finally {
    database.close();
  }
}

describe("SqliteAuthorizationSnapshotStore — activación y anti-replay", () => {
  it("accepts the first snapshot for a binding", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.activate(signed(claims()), BINDING)).toEqual({ kind: "ACTIVATED", sequence: 1 });
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(1);
    });
  });

  it("replaces the active snapshot with a strictly greater sequence", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      const next = signed(claims({ sequence: 2, snapshot_id: OTHER }));
      expect(store.activate(next, BINDING)).toEqual({ kind: "ACTIVATED", sequence: 2 });
      expect(store.loadActive(BINDING)?.claims.snapshot_id).toBe(OTHER);
    });
  });

  it("rejects an equal sequence as stale", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      const replay = signed(claims({ snapshot_id: OTHER }));
      expect(store.activate(replay, BINDING)).toEqual({ kind: "STALE_SEQUENCE", currentSequence: 1 });
    });
  });

  it("rejects a lower sequence as stale", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 5 })), BINDING);
      expect(store.activate(signed(claims({ sequence: 4 })), BINDING))
        .toEqual({ kind: "STALE_SEQUENCE", currentSequence: 5 });
    });
  });

  it("keeps the active snapshot untouched after a rejected replay", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 5 })), BINDING);
      store.activate(signed(claims({ sequence: 4, snapshot_id: OTHER })), BINDING);
      const active = store.loadActive(BINDING);
      expect(active?.claims.sequence).toBe(5);
      expect(active?.claims.snapshot_id).toBe(SNAPSHOT);
    });
  });

  it("keeps exactly one active snapshot per binding after several activations", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      for (const sequence of [1, 2, 3]) store.activate(signed(claims({ sequence })), BINDING);
      const rows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_authorization_snapshot")
        .get() as { total: number };
      expect(rows.total).toBe(1);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(3);
    });
  });
});

describe("SqliteAuthorizationSnapshotStore — binding", () => {
  it("rejects activating a snapshot under a binding that is not its own", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.activate(signed(claims()), { ...BINDING, userId: OTHER }))
        .toEqual({ kind: "BINDING_MISMATCH" });
    });
  });

  it("does not persist anything on a binding mismatch", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), { ...BINDING, deviceId: OTHER });
      const rows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_authorization_snapshot")
        .get() as { total: number };
      expect(rows.total).toBe(0);
    });
  });

  it("never returns another binding's snapshot", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      expect(store.loadActive({ ...BINDING, userId: OTHER })).toBeNull();
      expect(store.loadActive({ ...BINDING, deviceId: OTHER })).toBeNull();
      expect(store.loadActive({ ...BINDING, installationId: OTHER })).toBeNull();
    });
  });

  it("keeps snapshots of different users independent", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 7 })), BINDING);
      const otherUser = { ...BINDING, userId: OTHER };
      store.activate(signed(claims({ user_id: OTHER, sequence: 1 })), otherUser);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(7);
      expect(store.loadActive(otherUser)?.claims.sequence).toBe(1);
    });
  });
});

describe("SqliteAuthorizationSnapshotStore — vigencia", () => {
  it("does not return an expired snapshot", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const active = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      active.activate(signed(claims()), BINDING);
      const later = new SqliteAuthorizationSnapshotStore(
        database,
        () => new Date("2026-09-05T00:00:00Z"),
      );
      expect(later.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("treats the exact expiry instant as no longer active", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW)
        .activate(signed(claims()), BINDING);
      const atExpiry = new SqliteAuthorizationSnapshotStore(
        database,
        () => new Date("2026-09-04T00:00:00Z"),
      );
      expect(atExpiry.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("returns null instead of a warning, because there is no offline grace", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW)
        .activate(signed(claims()), BINDING);
      const late = new SqliteAuthorizationSnapshotStore(
        database,
        () => new Date("2026-09-04T00:00:01Z"),
      );
      expect(late.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("still stores an expired snapshot so a later replay cannot lower the sequence", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      store.activate(signed(claims({ sequence: 9 })), BINDING);
      const later = new SqliteAuthorizationSnapshotStore(
        database,
        () => new Date("2026-09-05T00:00:00Z"),
      );
      expect(later.loadActive(BINDING)).toBeNull();
      expect(later.activate(signed(claims({ sequence: 8 })), BINDING))
        .toEqual({ kind: "STALE_SEQUENCE", currentSequence: 9 });
    } finally {
      database.close();
    }
  });
});

describe("SqliteAuthorizationSnapshotStore — atomicidad", () => {
  /**
   * Interpone un fallo real en el INSERT para observar el rollback. No se
   * añade ningún gancho de test al código de producción: se envuelve la base
   * que el store recibe por constructor.
   */
  function failingOnInsert(database: LocalDatabase): LocalDatabase {
    const native = new Proxy(database.native, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.includes("INSERT INTO local_authorization_snapshot")) {
              throw new Error("simulated storage failure");
            }
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    return new Proxy(database, {
      get(target, property, receiver) {
        if (property === "native") return native;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  }

  it("propagates the failure instead of reporting a successful activation", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteAuthorizationSnapshotStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => store.activate(signed(claims()), BINDING)).toThrow(/simulated storage failure/);
    } finally {
      database.close();
    }
  });

  it("leaves no partially written snapshot when activation fails", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteAuthorizationSnapshotStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => store.activate(signed(claims()), BINDING)).toThrow();
      const rows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_authorization_snapshot")
        .get() as { total: number };
      expect(rows.total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("keeps the previous snapshot active and unchanged when a replacement fails", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      store.activate(signed(claims({ sequence: 3 })), BINDING);

      const failing = new SqliteAuthorizationSnapshotStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => failing.activate(signed(claims({ sequence: 4, snapshot_id: OTHER })), BINDING))
        .toThrow();

      const active = store.loadActive(BINDING);
      expect(active?.claims.sequence).toBe(3);
      expect(active?.claims.snapshot_id).toBe(SNAPSHOT);
    } finally {
      database.close();
    }
  });
});

describe("SqliteAuthorizationSnapshotStore — durabilidad e integridad", () => {
  it("keeps the active snapshot across a close and reopen", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    try {
      new SqliteAuthorizationSnapshotStore(first, () => INSIDE_WINDOW)
        .activate(signed(claims({ sequence: 4 })), BINDING);
    } finally {
      first.close();
    }

    const reopened = LocalDatabase.open({ dataDirectory });
    try {
      const store = new SqliteAuthorizationSnapshotStore(reopened, () => INSIDE_WINDOW);
      const active = store.loadActive(BINDING);
      expect(active?.claims.sequence).toBe(4);
      expect(active?.claims.assignments).toHaveLength(1);
      // La secuencia sobrevive al reinicio, así que un replay tampoco entra
      // después de reabrir la base.
      expect(store.activate(signed(claims({ sequence: 4 })), BINDING).kind).toBe("STALE_SEQUENCE");
    } finally {
      reopened.close();
    }
  });

  it("preserves the signature so the snapshot stays re-verifiable", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      const value = signed(claims());
      store.activate(value, BINDING);
      expect(store.loadActive(BINDING)?.signature).toBe(value.signature);
    });
  });

  it("refuses to serve a snapshot tampered with on disk", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), BINDING);
      database.native.prepare(
        "UPDATE local_authorization_snapshot SET claims_json=? WHERE user_id=?",
      ).run(JSON.stringify({ ...claims(), sequence: 99 }), USER);
      expect(() => store.loadActive(BINDING)).toThrow(/integrity checksum/);
    });
  });

  it("returns null for a binding that was never activated", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.loadActive(BINDING)).toBeNull();
    });
  });
});
