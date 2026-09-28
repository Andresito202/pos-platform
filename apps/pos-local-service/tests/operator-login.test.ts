import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  canonicalSessionTrustJson,
  type DeviceTrustChallenge,
  type OperatorSessionProvisioningArtifact,
  type SignedDeviceTrustCredential,
} from "@pos-platform/contracts";
import { unsignedDeviceTrustChallengeBytes } from "@pos-platform/device-trust";
import { verify } from "node:crypto";
import { SessionAssertionVerifier } from "../src/security/session-assertion-verifier.js";
import { TrustedClockGuard } from "../src/security/trusted-clock.js";
import { SessionActivationService } from "../src/session/session-activation.js";
import { SqliteSessionAssertionStore } from "../src/session/sqlite-session-assertion-store.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import { SessionBindingRegistry } from "../src/session/session-binding-registry.js";
import { activateOperatorSessionArtifact } from "../src/session/operator-session-artifact.js";
import { CentralLoginClient, type CentralLoginDevice } from "../src/session/central-login-client.js";
import { OperatorLoginService } from "../src/session/operator-login-service.js";
import { CentralTransportError, type CentralHttpRequest, type CentralTransport } from "../src/sync/central-transport.js";
import type { TrustedSigningKey } from "../src/security/license-verifier.js";

/**
 * `DEC-026` §13.11 — el login del operador en el POS, con la parte de
 * confianza **real**: almacenes SQLite, verificadores de SSA y SAS, reloj de
 * confianza y la misma `activateOperatorSessionArtifact` que usa el arranque
 * de `DEC-025`. Lo único doble es la autoridad central, y firma de verdad con
 * claves de test: lo que el POS acepta aquí lo acepta por su firma.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO ES EXCLUSIVO DE TEST.
 */

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) { try { database.close(); } catch { /* vacío */ } }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const INSTALLATION = "018f0000-0000-7000-8000-0000000e0002";
const DEVICE = "018f0000-0000-7000-8000-0000000e0003";
const TENANT = "018f0000-0000-7000-8000-0000000e0004";
const USER = "018f0000-0000-7000-8000-0000000e0001";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000e0011";
const SSA_KEY = generateKeyPairSync("ed25519");
const SAS_KEY = generateKeyPairSync("ed25519");
const DEVICE_KEY = generateKeyPairSync("ed25519");
const FOREIGN_KEY = generateKeyPairSync("ed25519");

const CREDENTIAL: SignedDeviceTrustCredential = {
  claims: {
    credential_id: "018f0000-0000-7000-8000-0000000e0020",
    key_id: "DEVICE-TRUST-TEST",
    tenant_id: TENANT,
    company_id: "018f0000-0000-7000-8000-0000000e0005",
    installation_id: INSTALLATION,
    device_id: DEVICE,
    device_public_key_pem: DEVICE_KEY.publicKey.export({ type: "spki", format: "pem" }).toString(),
    issued_at: "2026-09-01T00:00:00.000Z",
    not_before: "2026-09-01T00:00:00.000Z",
    expires_at: null,
    version: 1,
  },
  signature: "x".repeat(86),
};

const device: CentralLoginDevice = {
  installationId: INSTALLATION,
  deviceId: DEVICE,
  credential: CREDENTIAL,
  signChallenge: (challenge) => sign(null, challenge, DEVICE_KEY.privateKey),
};

let sequence = 0;
function signedArtifact(options: { sessionKey?: typeof SSA_KEY; deviceId?: string } = {}): OperatorSessionProvisioningArtifact {
  sequence += 1;
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 8 * 3_600_000).toISOString();
  const ssa = {
    session_id: randomUUID(), user_id: USER, tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION, device_id: options.deviceId ?? DEVICE,
    issued_at: issuedAt, offline_valid_until: expiresAt, sequence, key_id: "SSA-TEST",
  };
  const sas = {
    snapshot_id: randomUUID(), user_id: USER, installation_id: INSTALLATION, device_id: options.deviceId ?? DEVICE,
    sequence, issued_at: issuedAt, expires_at: expiresAt, key_id: "SAS-TEST",
    assignments: [{
      tenant_id: TENANT, company_id: null, branch_id: null, status: "ACTIVE", valid_from: issuedAt, valid_until: null,
      role_status: "ACTIVE", permissions: [{ code: "SALES_SALE_CREATE", status: "ACTIVE" }],
    }],
  };
  return {
    version: 1,
    session_assertion: { claims: ssa, signature: sign(null, Buffer.from(canonicalSessionTrustJson(ssa)), (options.sessionKey ?? SSA_KEY).privateKey).toString("base64url") },
    authorization_snapshot: { claims: sas, signature: sign(null, Buffer.from(canonicalSessionTrustJson(sas)), SAS_KEY.privateKey).toString("base64url") },
  } as OperatorSessionProvisioningArtifact;
}

/** Autoridad doble: emite el desafío, **verifica** la prueba del equipo y responde lo que se le pida. */
class FakeCentral implements CentralTransport {
  readonly requests: CentralHttpRequest[] = [];
  challenge: DeviceTrustChallenge | null = null;
  challengeDevice = DEVICE;
  loginAnswer: () => { result_code: string; result: unknown } = () => ({ result_code: "AUTHENTICATED", result: { session_id: "x", operator_session: signedArtifact() } });
  failWith: CentralTransportError | null = null;

  async send(request: CentralHttpRequest) {
    this.requests.push(request);
    if (this.failWith !== null) throw this.failWith;
    const body = JSON.parse(request.body) as Record<string, unknown>;
    if (request.url.endsWith("/v1/auth/device/challenge")) {
      this.challenge = {
        challenge_id: randomUUID(), tenant_id: TENANT, installation_id: INSTALLATION, device_id: this.challengeDevice,
        nonce: "n".repeat(43), issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
      };
      return { status: 200, headers: {}, body: JSON.stringify({ result_code: "ISSUED", result: this.challenge }) };
    }
    const proof = body["proof"] as { signature: string };
    const proofValid = verify(null, unsignedDeviceTrustChallengeBytes(this.challenge!), DEVICE_KEY.publicKey, Buffer.from(proof.signature, "base64url"));
    if (!proofValid) return { status: 200, headers: {}, body: JSON.stringify({ result_code: "DEVICE_REJECTED", result: null }) };
    return { status: 200, headers: {}, body: JSON.stringify(this.loginAnswer()) };
  }
}

function localTrust() {
  const directory = mkdtempSync(join(tmpdir(), "pos-login-"));
  directories.push(directory);
  const database = LocalDatabase.open({ dataDirectory: directory });
  databases.push(database);
  const clock = new TrustedClockGuard(database);
  const keys = (key: typeof SSA_KEY, id: string): ReadonlyMap<string, TrustedSigningKey> =>
    new Map([[id, { key: key.publicKey, status: "ACTIVE" as const }]]);
  const sessionStore = new SqliteSessionAssertionStore(database);
  const authorizationStore = new SqliteAuthorizationSnapshotStore(database);
  const sessionActivation = new SessionActivationService(new SessionAssertionVerifier(keys(SSA_KEY, "SSA-TEST"), clock), sessionStore);
  const activate = (artifact: OperatorSessionProvisioningArtifact) => activateOperatorSessionArtifact(artifact, {
    sessionActivation, authorizationSnapshotKeys: keys(SAS_KEY, "SAS-TEST"), trustedClock: clock, authorizationStore,
    installationId: INSTALLATION, deviceId: DEVICE,
  });
  return { database, sessionStore, authorizationStore, activate };
}

const REQUEST = { loginName: "cajero1", password: "caballo correcto grapa pila", totpCode: null };

describe("CentralLoginClient", () => {
  it("sólo habla https: por aquí viaja una contraseña", () => {
    expect(() => new CentralLoginClient("http://central.test", new FakeCentral())).toThrow(/https/);
  });

  it("firma el desafío con la clave del equipo y envía credencial, prueba y contraseña a la autoridad", async () => {
    const central = new FakeCentral();
    const result = await new CentralLoginClient("https://central.test", central).login(device, REQUEST, new AbortController().signal);
    expect(result.kind).toBe("AUTHENTICATED");
    expect(central.requests.map((request) => new URL(request.url).pathname)).toEqual(["/v1/auth/device/challenge", "/v1/auth/login"]);
    // El primer paso sólo da el `device_id`: nada de comercio ni de credencial.
    expect(JSON.parse(central.requests[0]!.body)).toEqual({ device_id: DEVICE });
  });

  it("no firma un desafío emitido para otro equipo", async () => {
    const central = new FakeCentral();
    central.challengeDevice = "018f0000-0000-7000-8000-0000000e00ff";
    const result = await new CentralLoginClient("https://central.test", central).login(device, REQUEST, new AbortController().signal);
    expect(result).toEqual({ kind: "REFUSED", outcome: "DEVICE_REJECTED", decision: "CHALLENGE_BINDING_MISMATCH", retryAt: null });
    expect(central.requests).toHaveLength(1);
  });

  it("devuelve tal cual los desenlaces de la autoridad y no convierte un código desconocido en éxito", async () => {
    const central = new FakeCentral();
    const client = new CentralLoginClient("https://central.test", central);
    for (const code of ["REJECTED", "THROTTLED", "MFA_REQUIRED", "MFA_INVALID", "PASSWORD_CHANGE_REQUIRED", "NO_ACTIVE_ROLE"]) {
      central.loginAnswer = () => ({ result_code: code, result: null });
      expect((await client.login(device, REQUEST, new AbortController().signal))).toMatchObject({ kind: "REFUSED", outcome: code });
    }
    central.loginAnswer = () => ({ result_code: "DEVICE_CREDENTIAL_EXPIRED", result: null });
    expect(await client.login(device, REQUEST, new AbortController().signal)).toMatchObject({ outcome: "DEVICE_REJECTED", decision: "DEVICE_CREDENTIAL_EXPIRED" });
    central.loginAnswer = () => ({ result_code: "SOMETHING_NEW", result: null });
    expect(await client.login(device, REQUEST, new AbortController().signal)).toMatchObject({ outcome: "REJECTED", decision: "SOMETHING_NEW" });
    central.loginAnswer = () => ({ result_code: "AUTHENTICATED", result: { session_id: "x", operator_session: null } });
    expect(await client.login(device, REQUEST, new AbortController().signal)).toEqual({ kind: "NOT_ISSUED" });
  });
});

describe("OperatorLoginService — activación real de los sobres recibidos", () => {
  it("un login aceptado activa SSA y SAS por la ruta canónica: la sesión y los permisos quedan en SQLite", async () => {
    const trust = localTrust();
    const central = new FakeCentral();
    const artifact = signedArtifact();
    central.loginAnswer = () => ({ result_code: "AUTHENTICATED", result: { session_id: "x", operator_session: artifact } });
    const service = new OperatorLoginService({ client: new CentralLoginClient("https://central.test", central), device: () => device, activate: trust.activate });

    const result = await service.login(REQUEST, new AbortController().signal);
    expect(result).toEqual({ kind: "AUTHENTICATED", claims: artifact.session_assertion.claims });
    const lookup = trust.sessionStore.loadActiveByDevice(INSTALLATION, DEVICE);
    expect(lookup.kind).toBe("FOUND");
    const snapshot = trust.authorizationStore.loadActive({ userId: USER, installationId: INSTALLATION, deviceId: DEVICE });
    expect(snapshot?.claims.assignments[0]?.permissions).toEqual([{ code: "SALES_SALE_CREATE", status: "ACTIVE" }]);
  });

  it("una SSA firmada con una clave que el ancla no conoce se rechaza y no deja sesión", async () => {
    const trust = localTrust();
    const central = new FakeCentral();
    central.loginAnswer = () => ({ result_code: "AUTHENTICATED", result: { session_id: "x", operator_session: signedArtifact({ sessionKey: FOREIGN_KEY }) } });
    const service = new OperatorLoginService({ client: new CentralLoginClient("https://central.test", central), device: () => device, activate: trust.activate });

    const result = await service.login(REQUEST, new AbortController().signal);
    expect(result).toMatchObject({ kind: "FAILED", outcome: "SESSION_REJECTED", decision: "SIGNATURE_INVALID" });
    expect(trust.sessionStore.loadActiveByDevice(INSTALLATION, DEVICE).kind).toBe("NONE");
  });

  it("sobres emitidos para otro equipo no se activan en éste", async () => {
    const trust = localTrust();
    const central = new FakeCentral();
    central.loginAnswer = () => ({ result_code: "AUTHENTICATED", result: { session_id: "x", operator_session: signedArtifact({ deviceId: "018f0000-0000-7000-8000-0000000e00ee" }) } });
    const service = new OperatorLoginService({ client: new CentralLoginClient("https://central.test", central), device: () => device, activate: trust.activate });
    expect(await service.login(REQUEST, new AbortController().signal)).toMatchObject({ kind: "FAILED", outcome: "SESSION_REJECTED" });
    expect(trust.sessionStore.loadActiveByDevice(INSTALLATION, DEVICE).kind).toBe("NONE");
  });

  it("sin credencial de equipo no hay login, y sin autoridad no se inventa", async () => {
    const trust = localTrust();
    const central = new FakeCentral();
    const client = new CentralLoginClient("https://central.test", central);
    expect(await new OperatorLoginService({ client, device: () => null, activate: trust.activate }).login(REQUEST, new AbortController().signal))
      .toMatchObject({ kind: "FAILED", outcome: "DEVICE_NOT_ENROLLED" });
    expect(central.requests).toHaveLength(0);

    central.failWith = new CentralTransportError("down", "CONNECTION_FAILURE", false);
    expect(await new OperatorLoginService({ client, device: () => device, activate: trust.activate }).login(REQUEST, new AbortController().signal))
      .toMatchObject({ kind: "FAILED", outcome: "CENTRAL_UNREACHABLE", decision: "CONNECTION_FAILURE" });
  });
});

describe("session.end — cierre durable (MIGRATION_036)", () => {
  it("una sesión cerrada deja de recuperarse; el cierre es append-only e idempotente; un login nuevo sí se recupera", async () => {
    const trust = localTrust();
    const first = signedArtifact();
    expect((await trust.activate(first)).decision).toBe("PROVISIONED");
    const binding = { userId: USER, installationId: INSTALLATION, deviceId: DEVICE };
    const sessionId = first.session_assertion.claims.session_id;

    expect(trust.sessionStore.endSession(randomUUID(), binding)).toBe(false);
    expect(trust.sessionStore.endSession(sessionId, binding)).toBe(true);
    expect(trust.sessionStore.endSession(sessionId, binding)).toBe(true);
    expect((trust.database.native.prepare("SELECT count(*) AS n FROM local_session_end").get() as { n: number }).n).toBe(1);
    expect(trust.sessionStore.loadActiveByDevice(INSTALLATION, DEVICE).kind).toBe("NONE");

    expect(() => trust.database.native.prepare("UPDATE local_session_end SET reason = 'OPERATOR_LOGOUT'").run()).toThrow(/append-only/);
    expect(() => trust.database.native.prepare("DELETE FROM local_session_end").run()).toThrow(/append-only/);

    // La SSA cerrada no puede volver a activarse: su secuencia ya no es mayor.
    expect((await trust.activate(first)).decision).toBe("SESSION_REJECTED");
    const second = signedArtifact();
    expect((await trust.activate(second)).decision).toBe("PROVISIONED");
    const lookup = trust.sessionStore.loadActiveByDevice(INSTALLATION, DEVICE);
    expect(lookup.kind === "FOUND" && lookup.session.claims.session_id).toBe(second.session_assertion.claims.session_id);
  });

  it("releaseSession libera todas las conexiones de esa sesión y ninguna de otra", () => {
    const registry = new SessionBindingRegistry();
    const identity = (session: string) => ({ userId: USER, ssaSessionId: session, tenantMembershipId: MEMBERSHIP, offlineValidUntil: new Date(Date.now() + 60_000).toISOString() });
    registry.bind("a", identity("S1"));
    registry.bind("b", identity("S1"));
    registry.bind("c", identity("S2"));
    expect(registry.releaseSession("S1")).toBe(2);
    expect(registry.resolve("a")).toBeNull();
    expect(registry.resolve("c")?.ssaSessionId).toBe("S2");
  });
});
