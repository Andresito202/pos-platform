import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SessionAssertionClaims } from "@pos-platform/contracts";
import {
  SessionActivationService,
  SessionAssertionVerifier,
  SqliteSessionAssertionStore,
  TrustedClockGuard,
  unsignedSessionAssertionBytes,
  type TrustedSigningKey,
} from "../src/index.js";

/** Material criptográfico exclusivo de test; ver SSA-002. */
const testOnlyKeyPair = generateKeyPairSync("ed25519");

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-ssa-store-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const SESSION = "018f0000-0000-7000-8000-0000000000b0";
const SESSION_B = "018f0000-0000-7000-8000-0000000000b9";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const OTHER = "018f0000-0000-7000-8000-0000000000ff";

const KEY_ID = "SESSION_KEY_1";
const BINDING = { userId: USER, installationId: INSTALLATION, deviceId: DEVICE };
const INSIDE_WINDOW = new Date("2026-09-03T12:00:00Z");
const AFTER_EXPIRY = new Date("2026-09-05T00:00:00Z");

function claims(overrides: Partial<SessionAssertionClaims> = {}): SessionAssertionClaims {
  return {
    session_id: SESSION,
    user_id: USER,
    tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    issued_at: "2026-09-03T00:00:00Z",
    offline_valid_until: "2026-09-04T00:00:00Z",
    sequence: 1,
    key_id: KEY_ID,
    ...overrides,
  } as SessionAssertionClaims;
}

function signed(value: SessionAssertionClaims) {
  return {
    claims: value,
    signature: sign(null, unsignedSessionAssertionBytes(value), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

function tamperSignature(signature: string): string {
  const bytes = Buffer.from(signature, "base64url");
  const first = bytes[0];
  if (first === undefined) throw new Error("signature must not be empty");
  bytes[0] = first ^ 0xff;
  return bytes.toString("base64url");
}

function trustedKeys(): Map<string, TrustedSigningKey> {
  return new Map([[KEY_ID, { key: createPublicKey(testOnlyKeyPair.privateKey), status: "ACTIVE" }]]);
}

async function withStore<T>(
  now: Date,
  run: (store: SqliteSessionAssertionStore, database: LocalDatabase) => T,
): Promise<T> {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  try {
    return run(new SqliteSessionAssertionStore(database, () => now), database);
  } finally {
    database.close();
  }
}

function serviceOver(database: LocalDatabase, now: Date): {
  service: SessionActivationService;
  store: SqliteSessionAssertionStore;
} {
  const store = new SqliteSessionAssertionStore(database, () => now);
  const verifier = new SessionAssertionVerifier(trustedKeys(), new TrustedClockGuard(database), () => now);
  return { service: new SessionActivationService(verifier, store), store };
}

/** Interpone un fallo real en el INSERT para observar el rollback. */
function failingOnInsert(database: LocalDatabase): LocalDatabase {
  const native = new Proxy(database.native, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          if (sql.includes("INSERT INTO local_session_assertion")) {
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

// ── Persistencia (1-7) ───────────────────────────────────────────────────────

describe("SqliteSessionAssertionStore — persistencia", () => {
  it("persists the first valid session assertion", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.activate(signed(claims()), BINDING)).toEqual({ kind: "ACTIVATED", sequence: 1 });
    });
  });

  it("recovers what it persisted", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      expect(store.loadActive(BINDING)?.claims.session_id).toBe(SESSION);
    });
  });

  it("survives closing and reopening SQLite", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    try {
      new SqliteSessionAssertionStore(first, () => INSIDE_WINDOW)
        .activate(signed(claims({ sequence: 4 })), BINDING);
    } finally {
      first.close();
    }

    const reopened = LocalDatabase.open({ dataDirectory });
    try {
      const store = new SqliteSessionAssertionStore(reopened, () => INSIDE_WINDOW);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(4);
      // La secuencia sobrevive al reinicio, así que un replay tampoco entra.
      expect(store.activate(signed(claims({ sequence: 4 })), BINDING).kind).toBe("STALE_SEQUENCE");
    } finally {
      reopened.close();
    }
  });

  it("preserves every claim exactly", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      const value = claims({ sequence: 3 });
      store.activate(signed(value), BINDING);
      expect(store.loadActive(BINDING)?.claims).toEqual(value);
    });
  });

  it("preserves the signature so the assertion stays re-verifiable", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      const value = signed(claims());
      store.activate(value, BINDING);
      expect(store.loadActive(BINDING)?.signature).toBe(value.signature);
    });
  });

  it("preserves the full binding", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      const active = store.loadActive(BINDING);
      expect(active?.claims.user_id).toBe(USER);
      expect(active?.claims.installation_id).toBe(INSTALLATION);
      expect(active?.claims.device_id).toBe(DEVICE);
      expect(active?.claims.tenant_membership_id).toBe(MEMBERSHIP);
    });
  });

  it("preserves the sequence", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 42 })), BINDING);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(42);
      expect(store.highestAcceptedSequence(BINDING)).toBe(42);
    });
  });

  it("refuses to serve an assertion tampered with on disk", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), BINDING);
      database.native.prepare(
        "UPDATE local_session_assertion SET claims_json=? WHERE user_id=?",
      ).run(JSON.stringify({ ...claims(), sequence: 99 }), USER);
      expect(() => store.loadActive(BINDING)).toThrow(/integrity checksum/);
    });
  });
});

// ── Anti-replay (8-14) ───────────────────────────────────────────────────────

describe("SqliteSessionAssertionStore — anti-replay", () => {
  it("rejects an equal sequence", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      expect(store.activate(signed(claims({ session_id: SESSION_B })), BINDING))
        .toEqual({ kind: "STALE_SEQUENCE", currentSequence: 1 });
    });
  });

  it("rejects a lower sequence", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 5 })), BINDING);
      expect(store.activate(signed(claims({ sequence: 4 })), BINDING))
        .toEqual({ kind: "STALE_SEQUENCE", currentSequence: 5 });
    });
  });

  it("accepts a strictly greater sequence", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      expect(store.activate(signed(claims({ sequence: 2, session_id: SESSION_B })), BINDING))
        .toEqual({ kind: "ACTIVATED", sequence: 2 });
    });
  });

  it("replaces the active session when the sequence is greater", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), BINDING);
      store.activate(signed(claims({ sequence: 2, session_id: SESSION_B })), BINDING);
      expect(store.loadActive(BINDING)?.claims.session_id).toBe(SESSION_B);
      const rows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_session_assertion").get() as { total: number };
      expect(rows.total).toBe(1);
    });
  });

  it("keeps the previous session when a replacement fails", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW);
      store.activate(signed(claims({ sequence: 3 })), BINDING);

      const failing = new SqliteSessionAssertionStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => failing.activate(signed(claims({ sequence: 4, session_id: SESSION_B })), BINDING))
        .toThrow(/simulated storage failure/);

      const active = store.loadActive(BINDING);
      expect(active?.claims.sequence).toBe(3);
      expect(active?.claims.session_id).toBe(SESSION);
    } finally {
      database.close();
    }
  });

  it("does not resurrect a previous state after rollback", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const failing = new SqliteSessionAssertionStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => failing.activate(signed(claims()), BINDING)).toThrow();
      const store = new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW);
      expect(store.loadActive(BINDING)).toBeNull();
      expect(store.highestAcceptedSequence(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("still blocks an old replay once the stored assertion expired", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW)
        .activate(signed(claims({ sequence: 9 })), BINDING);
      const later = new SqliteSessionAssertionStore(database, () => AFTER_EXPIRY);
      expect(later.loadActive(BINDING)).toBeNull();
      // Expirada, pero su secuencia sigue siendo la cota anti-replay.
      expect(later.highestAcceptedSequence(BINDING)).toBe(9);
      expect(later.activate(signed(claims({ sequence: 8 })), BINDING))
        .toEqual({ kind: "STALE_SEQUENCE", currentSequence: 9 });
    } finally {
      database.close();
    }
  });

  it("never uses issued_at as a precedence criterion", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 5 })), BINDING);
      // Emitida después, pero con secuencia menor: sigue siendo un replay.
      const newer = claims({ sequence: 4, issued_at: "2026-09-03T06:00:00Z" });
      expect(store.activate(signed(newer), BINDING).kind).toBe("STALE_SEQUENCE");
    });
  });
});

// ── Expiración (15-19) ───────────────────────────────────────────────────────

describe("SqliteSessionAssertionStore — expiración", () => {
  it("returns the session before expiry", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      expect(store.loadActive(BINDING)).not.toBeNull();
    });
  });

  it("treats the exact expiry instant as inactive", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW).activate(signed(claims()), BINDING);
      const atExpiry = new SqliteSessionAssertionStore(database, () => new Date("2026-09-04T00:00:00Z"));
      expect(atExpiry.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("returns null after expiry, with no grace", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW).activate(signed(claims()), BINDING);
      const late = new SqliteSessionAssertionStore(database, () => new Date("2026-09-04T00:00:01Z"));
      expect(late.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("does not delete the row just because it expired", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW).activate(signed(claims()), BINDING);
      const later = new SqliteSessionAssertionStore(database, () => AFTER_EXPIRY);
      expect(later.loadActive(BINDING)).toBeNull();
      const rows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_session_assertion").get() as { total: number };
      expect(rows.total).toBe(1);
    } finally {
      database.close();
    }
  });

  it("lets a later valid assertion replace an expired one", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW)
        .activate(signed(claims({ sequence: 2 })), BINDING);
      const later = new SqliteSessionAssertionStore(database, () => AFTER_EXPIRY);
      const renewed = claims({
        sequence: 3,
        session_id: SESSION_B,
        issued_at: "2026-09-05T00:00:00Z",
        offline_valid_until: "2026-09-06T00:00:00Z",
      });
      expect(later.activate(signed(renewed), BINDING)).toEqual({ kind: "ACTIVATED", sequence: 3 });
      expect(later.loadActive(BINDING)?.claims.session_id).toBe(SESSION_B);
    } finally {
      database.close();
    }
  });
});

// ── Binding (20-23) ──────────────────────────────────────────────────────────

describe("SqliteSessionAssertionStore — binding", () => {
  it("rejects activating under another user", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.activate(signed(claims()), { ...BINDING, userId: OTHER }))
        .toEqual({ kind: "BINDING_MISMATCH" });
    });
  });

  it("rejects activating under another installation", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.activate(signed(claims()), { ...BINDING, installationId: OTHER }))
        .toEqual({ kind: "BINDING_MISMATCH" });
    });
  });

  it("rejects activating under another device", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      expect(store.activate(signed(claims()), { ...BINDING, deviceId: OTHER }))
        .toEqual({ kind: "BINDING_MISMATCH" });
    });
  });

  it("accepts the correct binding and persists nothing on a mismatch", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), { ...BINDING, deviceId: OTHER });
      expect((database.native.prepare("SELECT COUNT(*) AS total FROM local_session_assertion")
        .get() as { total: number }).total).toBe(0);
      expect(store.activate(signed(claims()), BINDING).kind).toBe("ACTIVATED");
    });
  });

  it("never returns another binding's session", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims()), BINDING);
      expect(store.loadActive({ ...BINDING, userId: OTHER })).toBeNull();
      expect(store.loadActive({ ...BINDING, deviceId: OTHER })).toBeNull();
      expect(store.loadActive({ ...BINDING, installationId: OTHER })).toBeNull();
    });
  });

  it("keeps sessions of different devices independent", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 7 })), BINDING);
      const otherDevice = { ...BINDING, deviceId: OTHER };
      store.activate(signed(claims({ device_id: OTHER, sequence: 1 })), otherDevice);
      expect(store.highestAcceptedSequence(BINDING)).toBe(7);
      expect(store.highestAcceptedSequence(otherDevice)).toBe(1);
    });
  });
});

// ── Atomicidad (24-26) ───────────────────────────────────────────────────────

describe("SqliteSessionAssertionStore — atomicidad", () => {
  it("rolls back entirely when the initial insert fails", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteSessionAssertionStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => store.activate(signed(claims()), BINDING)).toThrow();
      expect((database.native.prepare("SELECT COUNT(*) AS total FROM local_session_assertion")
        .get() as { total: number }).total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("leaves the previous state intact when a replace fails", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteSessionAssertionStore(database, () => INSIDE_WINDOW);
      store.activate(signed(claims({ sequence: 2 })), BINDING);
      const failing = new SqliteSessionAssertionStore(failingOnInsert(database), () => INSIDE_WINDOW);
      expect(() => failing.activate(signed(claims({ sequence: 3 })), BINDING)).toThrow();
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(2);
    } finally {
      database.close();
    }
  });

  it("shows the correct previous state after reopening following a failure", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    try {
      new SqliteSessionAssertionStore(first, () => INSIDE_WINDOW)
        .activate(signed(claims({ sequence: 2 })), BINDING);
      const failing = new SqliteSessionAssertionStore(failingOnInsert(first), () => INSIDE_WINDOW);
      expect(() => failing.activate(signed(claims({ sequence: 3 })), BINDING)).toThrow();
    } finally {
      first.close();
    }

    const reopened = LocalDatabase.open({ dataDirectory });
    try {
      const store = new SqliteSessionAssertionStore(reopened, () => INSIDE_WINDOW);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(2);
      expect(store.highestAcceptedSequence(BINDING)).toBe(2);
    } finally {
      reopened.close();
    }
  });
});

// ── Concurrencia (27-28) ─────────────────────────────────────────────────────

describe("SqliteSessionAssertionStore — monotonía bajo concurrencia", () => {
  it("keeps the highest sequence when interleaved activations arrive out of order", async () => {
    await withStore(INSIDE_WINDOW, (store) => {
      store.activate(signed(claims({ sequence: 10 })), BINDING);
      // B (12) gana; A (11) llega después y no puede desplazarlo.
      expect(store.activate(signed(claims({ sequence: 12, session_id: SESSION_B })), BINDING).kind)
        .toBe("ACTIVATED");
      expect(store.activate(signed(claims({ sequence: 11 })), BINDING))
        .toEqual({ kind: "STALE_SEQUENCE", currentSequence: 12 });
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(12);
    });
  });

  it("compares the sequence inside the same transaction that writes", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims({ sequence: 5 })), BINDING);
      let observed = 0;
      // Una activación mayor mientras se observa: la lectura de comparación y
      // la escritura no pueden separarse.
      const spy = new Proxy(database.native, {
        get(target, property, receiver) {
          if (property === "prepare") {
            return (sql: string) => {
              if (sql.includes("SELECT sequence FROM local_session_assertion")) observed += 1;
              return target.prepare(sql);
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      const wrapped = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "native") return spy;
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      new SqliteSessionAssertionStore(wrapped, () => INSIDE_WINDOW)
        .activate(signed(claims({ sequence: 6 })), BINDING);
      expect(observed).toBe(1);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(6);
    });
  });
});

// ── Arquitectura y separación (29-35) ────────────────────────────────────────

describe("SSA-003 — arquitectura y separación", () => {
  it("the application port names no concrete database technology", async () => {
    const source = await readFile(
      new URL("../../../packages/application/src/session/session-assertion-store.ts", import.meta.url),
      "utf8",
    );
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers).toEqual(["@pos-platform/contracts"]);
    // Sobre el código ejecutable, no la prosa: el comentario del puerto nombra
    // deliberadamente las tecnologías que promete no acoplar.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["better-sqlite3", "kysely", "LocalDatabase", "SQLite", "sqlite"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("the persistence layer implements no authorization, presence or cash", async () => {
    const source = await readFile(
      new URL("../src/session/sqlite-session-assertion-store.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of [
      "evaluatePermission", "RoleAssignment", "permission", "role", "assignment",
      "presence", "PIN", "dpapi", "DPAPI", "cash", "Cash",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("activating a session creates no permissions, roles or assignments", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), BINDING);
      const stored = store.loadActive(BINDING);
      for (const forbidden of [
        "permissions", "assignments", "roles", "scopes", "entitlements", "cash_register_id",
      ]) {
        expect(Object.keys(stored?.claims ?? {})).not.toContain(forbidden);
      }
      // El snapshot de autorización permanece intacto y vacío.
      expect((database.native.prepare("SELECT COUNT(*) AS total FROM local_authorization_snapshot")
        .get() as { total: number }).total).toBe(0);
    });
  });

  it("stores no credential or token column", async () => {
    await withStore(INSIDE_WINDOW, (store, database) => {
      store.activate(signed(claims()), BINDING);
      const columns = (database.native.prepare("PRAGMA table_info(local_session_assertion)")
        .all() as { name: string }[]).map((column) => column.name);
      for (const forbidden of [
        "password", "access_token", "refresh_token", "mfa_secret", "presence", "credential",
      ]) {
        expect(columns).not.toContain(forbidden);
      }
      expect(columns).toContain("sequence");
      expect(columns).toContain("tenant_membership_id");
    });
  });
});

// ── Integración con SSA-002 ──────────────────────────────────────────────────

describe("SessionActivationService — el store no es una vía para saltarse el verificador", () => {
  it("an invalid signature is rejected and persistence is not modified", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service, store } = serviceOver(database, INSIDE_WINDOW);
      const valid = signed(claims());
      const tampered = { ...valid, signature: tamperSignature(valid.signature) };

      const result = service.activate(tampered, BINDING);
      expect(result).toEqual({ kind: "REJECTED", decision: "SIGNATURE_INVALID" });
      expect(store.loadActive(BINDING)).toBeNull();
      expect((database.native.prepare("SELECT COUNT(*) AS total FROM local_session_assertion")
        .get() as { total: number }).total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("a valid signature activates the session", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service, store } = serviceOver(database, INSIDE_WINDOW);
      expect(service.activate(signed(claims()), BINDING)).toEqual({ kind: "ACTIVATED", sequence: 1 });
      expect(store.loadActive(BINDING)?.claims.session_id).toBe(SESSION);
    } finally {
      database.close();
    }
  });

  it("an expired assertion never becomes active through the service", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service, store } = serviceOver(database, AFTER_EXPIRY);
      expect(service.activate(signed(claims()), BINDING))
        .toEqual({ kind: "REJECTED", decision: "EXPIRED" });
      expect(store.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("a binding mismatch is rejected before persistence", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service, store } = serviceOver(database, INSIDE_WINDOW);
      const result = service.activate(signed(claims()), { ...BINDING, userId: OTHER });
      expect(result).toEqual({ kind: "REJECTED", decision: "BINDING_MISMATCH" });
      expect(store.loadActive({ ...BINDING, userId: OTHER })).toBeNull();
    } finally {
      database.close();
    }
  });

  it("a structurally invalid payload never reaches the store", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service } = serviceOver(database, INSIDE_WINDOW);
      expect(() => service.activate({ nope: true }, BINDING)).toThrow();
      expect((database.native.prepare("SELECT COUNT(*) AS total FROM local_session_assertion")
        .get() as { total: number }).total).toBe(0);
    } finally {
      database.close();
    }
  });
});

// ── highestAcceptedSequence derivado del estado persistido ───────────────────

describe("SessionActivationService — baseline anti-replay durable", () => {
  it("derives the baseline from persisted state instead of a caller parameter", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service, store } = serviceOver(database, INSIDE_WINDOW);
      service.activate(signed(claims({ sequence: 5 })), BINDING);
      expect(store.highestAcceptedSequence(BINDING)).toBe(5);

      // El llamador no aporta baseline alguno: lo aporta el estado persistido.
      expect(service.activate(signed(claims({ sequence: 5, session_id: SESSION_B })), BINDING))
        .toEqual({ kind: "REJECTED", decision: "SEQUENCE_REPLAY" });
      expect(service.activate(signed(claims({ sequence: 4 })), BINDING))
        .toEqual({ kind: "REJECTED", decision: "SEQUENCE_REPLAY" });
      expect(service.activate(signed(claims({ sequence: 6, session_id: SESSION_B })), BINDING))
        .toEqual({ kind: "ACTIVATED", sequence: 6 });
    } finally {
      database.close();
    }
  });

  it("keeps the baseline across a restart", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    try {
      serviceOver(first, INSIDE_WINDOW).service.activate(signed(claims({ sequence: 8 })), BINDING);
    } finally {
      first.close();
    }
    const reopened = LocalDatabase.open({ dataDirectory });
    try {
      const { service } = serviceOver(reopened, INSIDE_WINDOW);
      expect(service.activate(signed(claims({ sequence: 8 })), BINDING))
        .toEqual({ kind: "REJECTED", decision: "SEQUENCE_REPLAY" });
    } finally {
      reopened.close();
    }
  });
});

// ── Recuperación ─────────────────────────────────────────────────────────────

describe("SessionActivationService — recuperación", () => {
  it("recovers a still valid session after a restart", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    try {
      serviceOver(first, INSIDE_WINDOW).service.activate(signed(claims({ sequence: 2 })), BINDING);
    } finally {
      first.close();
    }
    const reopened = LocalDatabase.open({ dataDirectory });
    try {
      const result = serviceOver(reopened, INSIDE_WINDOW).service.recover(BINDING);
      expect(result.kind).toBe("ACTIVE");
      if (result.kind === "ACTIVE") expect(result.session.claims.sequence).toBe(2);
    } finally {
      reopened.close();
    }
  });

  it("reports NONE when nothing was ever activated", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      expect(serviceOver(database, INSIDE_WINDOW).service.recover(BINDING)).toEqual({ kind: "NONE" });
    } finally {
      database.close();
    }
  });

  it("never recovers an expired session as active", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      serviceOver(database, INSIDE_WINDOW).service.activate(signed(claims()), BINDING);
      expect(serviceOver(database, AFTER_EXPIRY).service.recover(BINDING)).toEqual({ kind: "NONE" });
    } finally {
      database.close();
    }
  });

  it("re-verifies cryptographically and refuses a row tampered with on disk", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service } = serviceOver(database, INSIDE_WINDOW);
      service.activate(signed(claims()), BINDING);
      // Se altera la firma conservando el checksum de claims: el store la sirve,
      // y es la reverificación del servicio la que debe rechazarla.
      database.native.prepare("UPDATE local_session_assertion SET signature=? WHERE user_id=?")
        .run(tamperSignature(signed(claims()).signature), USER);
      const result = serviceOver(database, INSIDE_WINDOW).service.recover(BINDING);
      expect(result.kind).toBe("UNVERIFIABLE");
    } finally {
      database.close();
    }
  });

  it("recovery is not a login: it authenticates nobody and grants no permission", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const { service } = serviceOver(database, INSIDE_WINDOW);
      service.activate(signed(claims()), BINDING);
      const result = service.recover(BINDING);
      expect(result.kind).toBe("ACTIVE");
      if (result.kind === "ACTIVE") {
        expect(Object.keys(result.session)).toEqual(["claims", "signature", "activatedAt"]);
        expect(Object.keys(result.session.claims)).not.toContain("permissions");
      }
    } finally {
      database.close();
    }
  });
});
