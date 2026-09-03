import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import {
  AuthorizationSnapshotVerifier,
  TrustedClockGuard,
  unsignedAuthorizationSnapshotBytes,
  type TrustedSigningKey,
} from "../src/index.js";

/**
 * TODO EL MATERIAL CRIPTOGRÁFICO DE ESTE ARCHIVO ES EXCLUSIVO DE TEST.
 *
 * Las claves se generan en memoria en cada ejecución y no se persisten. No
 * constituyen ni sustituyen un trust anchor de producción, que permanece
 * BLOCKED conforme a DEC-011 hasta disponer de material real.
 */
const testOnlyKeyPair = generateKeyPairSync("ed25519");

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-authz-snapshot-"));
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

const KEY_ID = "AUTHZ_KEY_1";
const BINDING = { installationId: INSTALLATION, deviceId: DEVICE, userId: USER };
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
    key_id: KEY_ID,
    ...overrides,
  } as AuthorizationSnapshotClaims;
}

function signWithTestKey(value: AuthorizationSnapshotClaims): { claims: AuthorizationSnapshotClaims; signature: string } {
  return {
    claims: value,
    signature: sign(null, unsignedAuthorizationSnapshotBytes(value), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

function trustedKeys(status: TrustedSigningKey["status"] = "ACTIVE"): Map<string, TrustedSigningKey> {
  return new Map([[KEY_ID, { key: createPublicKey(testOnlyKeyPair.privateKey), status }]]);
}

async function verifierWith(
  keys: Map<string, TrustedSigningKey>,
  now: Date,
): Promise<{ verifier: AuthorizationSnapshotVerifier; close: () => void }> {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  return {
    verifier: new AuthorizationSnapshotVerifier(keys, new TrustedClockGuard(database), () => now),
    close: () => database.close(),
  };
}

describe("AuthorizationSnapshotVerifier — firma", () => {
  it("accepts a snapshot signed by an active trusted key", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const result = verifier.verify(signWithTestKey(claims()), BINDING);
    expect(result.decision).toBe("VALID");
    expect(result.claims?.snapshot_id).toBe(SNAPSHOT);
    close();
  });

  it("rejects a tampered signature", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const tampered = { ...signed, signature: `${signed.signature.slice(0, -1)}A` };
    const result = verifier.verify(tampered, BINDING);
    expect(result.decision).toBe("SIGNATURE_INVALID");
    close();
  });

  it("rejects claims modified after signing", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const forged = { claims: { ...signed.claims, sequence: 99 }, signature: signed.signature };
    expect(verifier.verify(forged, BINDING).decision).toBe("SIGNATURE_INVALID");
    close();
  });

  it("rejects a permission escalated after signing", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const escalated = {
      claims: {
        ...signed.claims,
        assignments: [
          {
            ...signed.claims.assignments[0]!,
            permissions: [
              { code: "CASH_SHIFT_OPEN", status: "ACTIVE" },
              { code: "CASH_SHIFT_CLOSE", status: "ACTIVE" },
            ],
          },
        ],
      },
      signature: signed.signature,
    };
    expect(verifier.verify(escalated, BINDING).decision).toBe("SIGNATURE_INVALID");
    close();
  });

  it("never returns claims when the signature is not proven", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const forged = { claims: { ...signed.claims, sequence: 99 }, signature: signed.signature };
    expect(verifier.verify(forged, BINDING).claims).toBeNull();
    close();
  });

  it("verifies independently of key order in the claims payload", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    // canonicalJson ordena las claves, así que reordenarlas no altera los bytes firmados.
    const reordered = {
      signature: signed.signature,
      claims: Object.fromEntries(Object.entries(signed.claims).reverse()),
    };
    expect(verifier.verify(reordered, BINDING).decision).toBe("VALID");
    close();
  });

  it("rejects a snapshot signed by a key the device does not trust", async () => {
    const stranger = generateKeyPairSync("ed25519");
    const keys = new Map<string, TrustedSigningKey>([
      [KEY_ID, { key: createPublicKey(stranger.privateKey), status: "ACTIVE" }],
    ]);
    const { verifier, close } = await verifierWith(keys, INSIDE_WINDOW);
    expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("SIGNATURE_INVALID");
    close();
  });

  it("reports an unknown key id as an invalid signature and not as its own cause", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims({ key_id: "AUTHZ_KEY_UNKNOWN" }));
    const result = verifier.verify(signed, BINDING);
    expect(result.decision).toBe("SIGNATURE_INVALID");
    expect(result.claims).toBeNull();
    close();
  });
});

describe("AuthorizationSnapshotVerifier — estado de la clave", () => {
  it("rejects a snapshot signed by a revoked key", async () => {
    const { verifier, close } = await verifierWith(trustedKeys("REVOKED"), INSIDE_WINDOW);
    const result = verifier.verify(signWithTestKey(claims()), BINDING);
    expect(result.decision).toBe("SIGNING_KEY_REVOKED");
    expect(result.claims).toBeNull();
    close();
  });

  it("still verifies with a VERIFY_ONLY key so rotation needs no cutover window", async () => {
    const { verifier, close } = await verifierWith(trustedKeys("VERIFY_ONLY"), INSIDE_WINDOW);
    expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("VALID");
    close();
  });

  it("prefers revocation over signature verification", async () => {
    const { verifier, close } = await verifierWith(trustedKeys("REVOKED"), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const tampered = { ...signed, signature: `${signed.signature.slice(0, -1)}A` };
    expect(verifier.verify(tampered, BINDING).decision).toBe("SIGNING_KEY_REVOKED");
    close();
  });
});

describe("AuthorizationSnapshotVerifier — binding", () => {
  it("rejects a snapshot issued for another installation", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const result = verifier.verify(signWithTestKey(claims()), { ...BINDING, installationId: OTHER });
    expect(result.decision).toBe("BINDING_MISMATCH");
    close();
  });

  it("rejects a snapshot issued for another device", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    expect(verifier.verify(signWithTestKey(claims()), { ...BINDING, deviceId: OTHER }).decision)
      .toBe("BINDING_MISMATCH");
    close();
  });

  it("rejects a snapshot issued for another user", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    expect(verifier.verify(signWithTestKey(claims()), { ...BINDING, userId: OTHER }).decision)
      .toBe("BINDING_MISMATCH");
    close();
  });

  it("returns claims on a binding mismatch because the signature was already proven", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const result = verifier.verify(signWithTestKey(claims()), { ...BINDING, userId: OTHER });
    expect(result.claims?.user_id).toBe(USER);
    close();
  });
});

describe("AuthorizationSnapshotVerifier — vigencia", () => {
  it("rejects a snapshot whose window already closed", async () => {
    const { verifier, close } = await verifierWith(
      trustedKeys(),
      new Date("2026-09-05T00:00:00Z"),
    );
    expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("EXPIRED");
    close();
  });

  it("treats the exact expiry instant as expired", async () => {
    const { verifier, close } = await verifierWith(
      trustedKeys(),
      new Date("2026-09-04T00:00:00Z"),
    );
    expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("EXPIRED");
    close();
  });

  it("accepts the exact issuing instant", async () => {
    const { verifier, close } = await verifierWith(
      trustedKeys(),
      new Date("2026-09-03T00:00:00Z"),
    );
    expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("VALID");
    close();
  });

  it("rejects a future dated snapshot", async () => {
    const { verifier, close } = await verifierWith(
      trustedKeys(),
      new Date("2026-09-02T00:00:00Z"),
    );
    expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("NOT_YET_VALID");
    close();
  });

  it("does not grant offline grace, unlike a license", async () => {
    const { verifier, close } = await verifierWith(
      trustedKeys(),
      new Date("2026-09-04T00:00:01Z"),
    );
    const result = verifier.verify(signWithTestKey(claims()), BINDING);
    expect(result.decision).toBe("EXPIRED");
    close();
  });

  it("rejects a clock rolled back beyond the trusted tolerance", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    const clock = new TrustedClockGuard(database);
    clock.accept(new Date("2026-09-03T12:00:00Z"));
    const verifier = new AuthorizationSnapshotVerifier(
      trustedKeys(),
      clock,
      () => new Date("2026-09-03T00:00:00Z"),
    );
    expect(() => verifier.verify(signWithTestKey(claims()), BINDING)).toThrow(/clock rollback/);
    database.close();
  });
});

describe("AuthorizationSnapshotVerifier — validación estructural", () => {
  it("rejects a payload that is not a signed snapshot", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    expect(() => verifier.verify({ nope: true }, BINDING)).toThrow();
    close();
  });

  it("rejects an incomplete payload", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    expect(() => verifier.verify({ claims: claims() }, BINDING)).toThrow();
    close();
  });

  it("rejects unexpected fields in the envelope", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    expect(() => verifier.verify({ ...signed, algorithm: "ED25519" }, BINDING)).toThrow();
    close();
  });

  it("rejects an invalid assignment scope before verifying anything", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const invalid = signWithTestKey(claims());
    const broken = {
      claims: {
        ...invalid.claims,
        assignments: [{ ...invalid.claims.assignments[0]!, company_id: null }],
      },
      signature: invalid.signature,
    };
    expect(() => verifier.verify(broken, BINDING)).toThrow();
    close();
  });

  it("rejects an inverted validity window", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const broken = {
      claims: { ...signed.claims, expires_at: "2026-09-02T00:00:00Z" },
      signature: signed.signature,
    };
    expect(() => verifier.verify(broken, BINDING)).toThrow();
    close();
  });

  it("rejects an invalid permission code", async () => {
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    const signed = signWithTestKey(claims());
    const broken = {
      claims: {
        ...signed.claims,
        assignments: [{
          ...signed.claims.assignments[0]!,
          permissions: [{ code: "cash shift open", status: "ACTIVE" }],
        }],
      },
      signature: signed.signature,
    };
    expect(() => verifier.verify(broken, BINDING)).toThrow();
    close();
  });
});

describe("unsignedAuthorizationSnapshotBytes", () => {
  it("produces the exact bytes covered by the signature", async () => {
    const value = claims();
    const bytes = unsignedAuthorizationSnapshotBytes(value);
    const signature = sign(null, bytes, testOnlyKeyPair.privateKey).toString("base64url");
    const { verifier, close } = await verifierWith(trustedKeys(), INSIDE_WINDOW);
    expect(verifier.verify({ claims: value, signature }, BINDING).decision).toBe("VALID");
    close();
  });

  it("is stable regardless of property order", () => {
    const value = claims();
    const reordered = Object.fromEntries(
      Object.entries(value).reverse(),
    ) as unknown as AuthorizationSnapshotClaims;
    expect(unsignedAuthorizationSnapshotBytes(reordered).toString())
      .toBe(unsignedAuthorizationSnapshotBytes(value).toString());
  });

  it("changes when any claim changes", () => {
    const base = unsignedAuthorizationSnapshotBytes(claims()).toString();
    expect(unsignedAuthorizationSnapshotBytes(claims({ sequence: 2 })).toString()).not.toBe(base);
  });
});
