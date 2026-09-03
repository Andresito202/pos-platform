import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims, SignedAuthorizationSnapshot } from "@pos-platform/contracts";
import {
  AuthorizationSnapshotVerifier,
  TrustedClockGuard,
  SqliteAuthorizationSnapshotStore,
  SnapshotAcquisitionService,
  unsignedAuthorizationSnapshotBytes,
  type SnapshotBinding,
  type SnapshotProvider,
  type TrustedSigningKey,
} from "../src/index.js";

/**
 * TODO EL MATERIAL CRIPTOGRÁFICO DE ESTE ARCHIVO ES EXCLUSIVO DE TEST.
 *
 * Generado en memoria por ejecución; no constituye ni sustituye un trust
 * anchor de producción, que permanece BLOCKED conforme a DEC-011.
 */
const testOnlyKeyPair = generateKeyPairSync("ed25519");

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-sas003-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const SNAPSHOT_A = "018f0000-0000-7000-8000-0000000000a0";
const SNAPSHOT_B = "018f0000-0000-7000-8000-0000000000b0";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const TENANT = "018f0000-0000-7000-8000-0000000000a4";
const COMPANY = "018f0000-0000-7000-8000-0000000000a5";
const BRANCH = "018f0000-0000-7000-8000-0000000000a6";
const OTHER_USER = "018f0000-0000-7000-8000-0000000000ff";

const KEY_ID = "AUTHZ_KEY_1";
const BINDING: SnapshotBinding = { userId: USER, installationId: INSTALLATION, deviceId: DEVICE };
const INSIDE_WINDOW = new Date("2026-09-03T12:00:00Z");

function makeClaims(overrides: Partial<AuthorizationSnapshotClaims> = {}): AuthorizationSnapshotClaims {
  return {
    snapshot_id: SNAPSHOT_A,
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
    key_id: KEY_ID,
    ...overrides,
  } as AuthorizationSnapshotClaims;
}

function signedSnapshot(value: AuthorizationSnapshotClaims): SignedAuthorizationSnapshot {
  return {
    claims: value,
    signature: sign(null, unsignedAuthorizationSnapshotBytes(value), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

function tamperSignature(signature: string): string {
  const bytes = Buffer.from(signature, "base64url");
  const first = bytes[0];
  if (first === undefined) throw new Error("signature must not be empty");
  bytes[0] = first ^ 0xff;
  const tampered = bytes.toString("base64url");
  if (tampered === signature) throw new Error("tampering did not change the signature bytes");
  return tampered;
}

function trustedKeys(status: TrustedSigningKey["status"] = "ACTIVE"): Map<string, TrustedSigningKey> {
  return new Map([[KEY_ID, { key: createPublicKey(testOnlyKeyPair.privateKey), status }]]);
}

/**
 * Adaptador de prueba del SnapshotProvider.
 *
 * Devuelve el snapshot configurado o lanza el error configurado. No hace HTTP
 * ni contacta a ninguna autoridad externa; es el único adaptador necesario
 * mientras el transporte productivo no existe.
 */
class FixtureSnapshotProvider implements SnapshotProvider {
  constructor(private readonly response: SignedAuthorizationSnapshot | Error) {}
  async fetch(_binding: SnapshotBinding): Promise<SignedAuthorizationSnapshot> {
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

async function buildService(
  snapshot: SignedAuthorizationSnapshot | Error,
  now: Date = INSIDE_WINDOW,
  keys: Map<string, TrustedSigningKey> = trustedKeys(),
): Promise<{
  service: SnapshotAcquisitionService;
  store: SqliteAuthorizationSnapshotStore;
  database: LocalDatabase;
}> {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  const clock = new TrustedClockGuard(database);
  const verifier = new AuthorizationSnapshotVerifier(keys, clock, () => now);
  const store = new SqliteAuthorizationSnapshotStore(database, () => now);
  const provider = new FixtureSnapshotProvider(snapshot);
  const service = new SnapshotAcquisitionService(provider, verifier, store);
  return { service, store, database };
}

// ── Test 1: acquisition exitosa ─────────────────────────────────────────────

describe("SnapshotAcquisitionService — acquisition exitosa", () => {
  it("returns ACQUIRED and the snapshot becomes active", async () => {
    const { service, store, database } = await buildService(signedSnapshot(makeClaims()));
    try {
      const outcome = await service.acquire(BINDING);
      expect(outcome).toEqual({ kind: "ACQUIRED", sequence: 1 });
      expect(store.loadActive(BINDING)?.claims.snapshot_id).toBe(SNAPSHOT_A);
    } finally {
      database.close();
    }
  });
});

// ── Test 2: firma inválida rechazada ─────────────────────────────────────────

describe("SnapshotAcquisitionService — firma inválida rechazada", () => {
  it("returns VERIFICATION_FAILED and never activates", async () => {
    const valid = signedSnapshot(makeClaims());
    const tampered = { ...valid, signature: tamperSignature(valid.signature) };
    const { service, store, database } = await buildService(tampered);
    try {
      const outcome = await service.acquire(BINDING);
      expect(outcome).toEqual({ kind: "VERIFICATION_FAILED", decision: "SIGNATURE_INVALID" });
      expect(store.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });
});

// ── Test 3: binding incorrecto rechazado ─────────────────────────────────────

describe("SnapshotAcquisitionService — binding incorrecto rechazado", () => {
  it("returns VERIFICATION_FAILED when the snapshot was issued for another user", async () => {
    const wrongUser = signedSnapshot(makeClaims({ user_id: OTHER_USER }));
    const { service, store, database } = await buildService(wrongUser);
    try {
      const outcome = await service.acquire(BINDING);
      expect(outcome).toEqual({ kind: "VERIFICATION_FAILED", decision: "BINDING_MISMATCH" });
      expect(store.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });
});

// ── Tests 4 & 5: sequence menor e igual rechazados ───────────────────────────

describe("SnapshotAcquisitionService — sequence stale", () => {
  it("returns STALE_SEQUENCE when the incoming sequence is lower than the active one", async () => {
    const first = signedSnapshot(makeClaims({ sequence: 5 }));
    const { service, store, database } = await buildService(first);
    try {
      await service.acquire(BINDING);

      const staleProvider = new FixtureSnapshotProvider(signedSnapshot(makeClaims({ sequence: 4 })));
      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const staleService = new SnapshotAcquisitionService(staleProvider, verifier, store);

      const outcome = await staleService.acquire(BINDING);
      expect(outcome).toEqual({ kind: "STALE_SEQUENCE", currentSequence: 5 });
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(5);
    } finally {
      database.close();
    }
  });

  it("returns STALE_SEQUENCE when the incoming sequence equals the active one", async () => {
    const first = signedSnapshot(makeClaims({ sequence: 3 }));
    const { service, store, database } = await buildService(first);
    try {
      await service.acquire(BINDING);

      const equalProvider = new FixtureSnapshotProvider(
        signedSnapshot(makeClaims({ sequence: 3, snapshot_id: SNAPSHOT_B })),
      );
      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const equalService = new SnapshotAcquisitionService(equalProvider, verifier, store);

      const outcome = await equalService.acquire(BINDING);
      expect(outcome).toEqual({ kind: "STALE_SEQUENCE", currentSequence: 3 });
      expect(store.loadActive(BINDING)?.claims.snapshot_id).toBe(SNAPSHOT_A);
    } finally {
      database.close();
    }
  });
});

// ── Test 6: sequence mayor aceptado ─────────────────────────────────────────

describe("SnapshotAcquisitionService — sequence mayor aceptado", () => {
  it("activates a strictly greater sequence and replaces the previous snapshot", async () => {
    const { service, store, database } = await buildService(signedSnapshot(makeClaims({ sequence: 2 })));
    try {
      await service.acquire(BINDING);

      const nextProvider = new FixtureSnapshotProvider(
        signedSnapshot(makeClaims({ sequence: 3, snapshot_id: SNAPSHOT_B })),
      );
      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const nextService = new SnapshotAcquisitionService(nextProvider, verifier, store);

      const outcome = await nextService.acquire(BINDING);
      expect(outcome).toEqual({ kind: "ACQUIRED", sequence: 3 });
      expect(store.loadActive(BINDING)?.claims.snapshot_id).toBe(SNAPSHOT_B);
    } finally {
      database.close();
    }
  });
});

// ── Test 7: fallo de persistencia conserva snapshot anterior ─────────────────

describe("SnapshotAcquisitionService — fallo de persistencia", () => {
  it("propagates the storage error and the previous snapshot remains active", async () => {
    const { service, store, database } = await buildService(
      signedSnapshot(makeClaims({ sequence: 3 })),
    );
    try {
      await service.acquire(BINDING);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(3);

      // Envuelve la DB para hacer fallar el INSERT en la siguiente activación.
      const failingNative = new Proxy(database.native, {
        get(target, property, receiver) {
          if (property === "prepare") {
            return (sql: string) => {
              if (sql.includes("INSERT INTO local_authorization_snapshot")) {
                throw new Error("simulated disk failure");
              }
              return target.prepare(sql);
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      const failingDatabase = new Proxy(database, {
        get(target, property, receiver) {
          if (property === "native") return failingNative;
          return Reflect.get(target, property, receiver) as unknown;
        },
      });

      const failingStore = new SqliteAuthorizationSnapshotStore(failingDatabase, () => INSIDE_WINDOW);
      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const failingProvider = new FixtureSnapshotProvider(
        signedSnapshot(makeClaims({ sequence: 4, snapshot_id: SNAPSHOT_B })),
      );
      const failingService = new SnapshotAcquisitionService(failingProvider, verifier, failingStore);

      await expect(failingService.acquire(BINDING)).rejects.toThrow(/simulated disk failure/);

      // El snapshot anterior no fue destruido.
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(3);
      expect(store.loadActive(BINDING)?.claims.snapshot_id).toBe(SNAPSHOT_A);
    } finally {
      database.close();
    }
  });
});

// ── Test 8: snapshot expirado no queda activo ────────────────────────────────

describe("SnapshotAcquisitionService — snapshot expirado no queda activo", () => {
  it("returns VERIFICATION_FAILED for an expired snapshot from the provider", async () => {
    const expiredClaims = makeClaims({
      issued_at: "2026-09-01T00:00:00Z",
      expires_at: "2026-09-02T00:00:00Z",
    });
    const { service, store, database } = await buildService(
      signedSnapshot(expiredClaims),
      INSIDE_WINDOW,
    );
    try {
      const outcome = await service.acquire(BINDING);
      expect(outcome).toEqual({ kind: "VERIFICATION_FAILED", decision: "EXPIRED" });
      expect(store.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });
});

// ── Test 9: proveedor externo caído no destruye snapshot local válido ─────────

describe("SnapshotAcquisitionService — proveedor externo caído", () => {
  it("returns PROVIDER_UNAVAILABLE and the existing local snapshot stays active", async () => {
    const { service, store, database } = await buildService(signedSnapshot(makeClaims({ sequence: 2 })));
    try {
      await service.acquire(BINDING);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(2);

      const downProvider = new FixtureSnapshotProvider(new Error("connection refused"));
      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const downService = new SnapshotAcquisitionService(downProvider, verifier, store);

      const outcome = await downService.acquire(BINDING);
      expect(outcome.kind).toBe("PROVIDER_UNAVAILABLE");

      // El snapshot local válido permanece.
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(2);
    } finally {
      database.close();
    }
  });
});

// ── Test 10: ausencia de snapshot válido → fail-closed ──────────────────────

describe("SnapshotAcquisitionService — fail-closed sin snapshot válido", () => {
  it("loadActive returns null when no snapshot has ever been acquired", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const store = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      // Sin adquisición previa, no existe snapshot activo.
      expect(store.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });

  it("loadActive returns null after the only snapshot expires", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const store = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      const provider = new FixtureSnapshotProvider(signedSnapshot(makeClaims()));
      const service = new SnapshotAcquisitionService(provider, verifier, store);

      await service.acquire(BINDING);
      expect(store.loadActive(BINDING)?.claims.sequence).toBe(1);

      // El mismo store con el reloj avanzado más allá de expires_at.
      const afterExpiry = new SqliteAuthorizationSnapshotStore(
        database,
        () => new Date("2026-09-05T00:00:00Z"),
      );
      expect(afterExpiry.loadActive(BINDING)).toBeNull();
    } finally {
      database.close();
    }
  });
});

// ── Test 11: activación siempre pasa por verifier + store ───────────────────

describe("SnapshotAcquisitionService — única ruta canónica de activación", () => {
  it("a tampered snapshot never reaches the store (verifier rejects before activate)", async () => {
    const valid = signedSnapshot(makeClaims());
    const tampered = { ...valid, signature: tamperSignature(valid.signature) };

    let storeActivateCalled = false;
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const realStore = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      const watchedStore: typeof realStore = new Proxy(realStore, {
        get(target, property, receiver) {
          if (property === "activate") {
            return (...args: Parameters<typeof realStore.activate>) => {
              storeActivateCalled = true;
              return target.activate(...args);
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });

      const clock = new TrustedClockGuard(database);
      const verifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const provider = new FixtureSnapshotProvider(tampered);
      const service = new SnapshotAcquisitionService(provider, verifier, watchedStore);

      const outcome = await service.acquire(BINDING);
      expect(outcome).toEqual({ kind: "VERIFICATION_FAILED", decision: "SIGNATURE_INVALID" });
      expect(storeActivateCalled).toBe(false);
    } finally {
      database.close();
    }
  });

  it("a valid snapshot always goes through both verifier and store before being active", async () => {
    let verifierCalled = false;
    let storeActivateCalled = false;

    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const realStore = new SqliteAuthorizationSnapshotStore(database, () => INSIDE_WINDOW);
      const watchedStore: typeof realStore = new Proxy(realStore, {
        get(target, property, receiver) {
          if (property === "activate") {
            return (...args: Parameters<typeof realStore.activate>) => {
              storeActivateCalled = true;
              return target.activate(...args);
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });

      const clock = new TrustedClockGuard(database);
      const realVerifier = new AuthorizationSnapshotVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      const watchedVerifier: typeof realVerifier = new Proxy(realVerifier, {
        get(target, property, receiver) {
          if (property === "verify") {
            return (...args: Parameters<typeof realVerifier.verify>) => {
              verifierCalled = true;
              return target.verify(...args);
            };
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      });

      const provider = new FixtureSnapshotProvider(signedSnapshot(makeClaims()));
      const service = new SnapshotAcquisitionService(provider, watchedVerifier, watchedStore);

      const outcome = await service.acquire(BINDING);
      expect(outcome).toEqual({ kind: "ACQUIRED", sequence: 1 });
      expect(verifierCalled).toBe(true);
      expect(storeActivateCalled).toBe(true);
    } finally {
      database.close();
    }
  });
});
