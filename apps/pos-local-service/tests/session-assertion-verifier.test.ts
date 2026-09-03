import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SessionAssertionClaims } from "@pos-platform/contracts";
import {
  SessionAssertionVerifier,
  TrustedClockGuard,
  unsignedSessionAssertionBytes,
  type TrustedSigningKey,
} from "../src/index.js";

/**
 * TODO EL MATERIAL CRIPTOGRÁFICO DE ESTE ARCHIVO ES EXCLUSIVO DE TEST.
 *
 * Las claves se generan en memoria en cada ejecución y no se persisten. No
 * constituyen ni sustituyen un trust anchor de producción, que permanece
 * BLOCKED conforme a DEC-011/DEC-012.
 */
const testOnlyKeyPair = generateKeyPairSync("ed25519");

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-ssa-verifier-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const SESSION = "018f0000-0000-7000-8000-0000000000b0";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";
const OTHER = "018f0000-0000-7000-8000-0000000000ff";

const KEY_ID = "SESSION_KEY_1";
const BINDING = { userId: USER, installationId: INSTALLATION, deviceId: DEVICE };
const INSIDE_WINDOW = new Date("2026-09-03T12:00:00Z");

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

function signWithTestKey(value: SessionAssertionClaims): { claims: SessionAssertionClaims; signature: string } {
  return {
    claims: value,
    signature: sign(null, unsignedSessionAssertionBytes(value), testOnlyKeyPair.privateKey)
      .toString("base64url"),
  };
}

/**
 * Altera un byte real de los 64 de la firma Ed25519. Sustituir el último
 * carácter base64url no basta: aporta solo bits de relleno y varios caracteres
 * decodifican al mismo byte, de modo que la firma podía seguir siendo válida.
 */
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
 * La base se cierra en `finally` para que una aserción fallida no deje el
 * archivo SQLite abierto: en Windows eso hace fallar el borrado del directorio
 * temporal con EBUSY y enmascara la causa real.
 */
async function withVerifier<T>(
  keys: Map<string, TrustedSigningKey>,
  now: Date,
  run: (verifier: SessionAssertionVerifier) => T,
): Promise<T> {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  try {
    return run(new SessionAssertionVerifier(keys, new TrustedClockGuard(database), () => now));
  } finally {
    database.close();
  }
}

// ── Firma (1-8) ──────────────────────────────────────────────────────────────

describe("SessionAssertionVerifier — firma", () => {
  it("accepts a session assertion signed by an active trusted key", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims()), BINDING);
      expect(result.decision).toBe("VALID");
      expect(result.claims?.session_id).toBe(SESSION);
    });
  });

  it("rejects a tampered signature", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      const tampered = { ...signed, signature: tamperSignature(signed.signature) };
      expect(verifier.verify(tampered, BINDING).decision).toBe("SIGNATURE_INVALID");
    });
  });

  it("rejects claims modified after signing", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      const forged = { claims: { ...signed.claims, sequence: 99 }, signature: signed.signature };
      expect(verifier.verify(forged, BINDING).decision).toBe("SIGNATURE_INVALID");
    });
  });

  it("rejects a user swapped after signing", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      const forged = { claims: { ...signed.claims, user_id: OTHER }, signature: signed.signature };
      expect(verifier.verify(forged, { ...BINDING, userId: OTHER }).decision).toBe("SIGNATURE_INVALID");
    });
  });

  it("verifies against the canonical form, not the serialisation order received", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      // canonicalJson ordena las claves: reordenarlas no altera los bytes firmados.
      const reordered = {
        signature: signed.signature,
        claims: Object.fromEntries(Object.entries(signed.claims).reverse()),
      };
      expect(verifier.verify(reordered, BINDING).decision).toBe("VALID");
    });
  });

  it("rejects a signature produced over non-canonical JSON", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const value = claims();
      // Firma sobre JSON.stringify crudo: su orden de inserción no es el
      // alfabético que produce canonicalJson, así que los bytes difieren.
      expect(JSON.stringify(value)).not.toBe(unsignedSessionAssertionBytes(value).toString());
      const nonCanonical = sign(
        null,
        Buffer.from(JSON.stringify(value)),
        testOnlyKeyPair.privateKey,
      ).toString("base64url");
      expect(verifier.verify({ claims: value, signature: nonCanonical }, BINDING).decision)
        .toBe("SIGNATURE_INVALID");
    });
  });

  it("never returns claims when the signature is not proven", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      const forged = { claims: { ...signed.claims, sequence: 99 }, signature: signed.signature };
      expect(verifier.verify(forged, BINDING).claims).toBeNull();
    });
  });

  it("rejects an assertion signed by a key the device does not trust", async () => {
    const stranger = generateKeyPairSync("ed25519");
    const keys = new Map<string, TrustedSigningKey>([
      [KEY_ID, { key: createPublicKey(stranger.privateKey), status: "ACTIVE" }],
    ]);
    await withVerifier(keys, INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("SIGNATURE_INVALID");
    });
  });

  it("reports an unknown key id as an invalid signature and not as its own cause", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims({ key_id: "SESSION_KEY_UNKNOWN" }));
      const result = verifier.verify(signed, BINDING);
      expect(result.decision).toBe("SIGNATURE_INVALID");
      expect(result.claims).toBeNull();
    });
  });

  it("never trusts a key carried inside the assertion itself", async () => {
    const stranger = generateKeyPairSync("ed25519");
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const value = claims();
      const signature = sign(null, unsignedSessionAssertionBytes(value), stranger.privateKey)
        .toString("base64url");
      expect(verifier.verify({ claims: value, signature }, BINDING).decision).toBe("SIGNATURE_INVALID");
    });
  });
});

describe("SessionAssertionVerifier — estado de la clave", () => {
  it("rejects an assertion signed by a revoked key", async () => {
    await withVerifier(trustedKeys("REVOKED"), INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims()), BINDING);
      expect(result.decision).toBe("SIGNING_KEY_REVOKED");
      expect(result.claims).toBeNull();
    });
  });

  it("still verifies with a VERIFY_ONLY key so rotation needs no cutover window", async () => {
    await withVerifier(trustedKeys("VERIFY_ONLY"), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("VALID");
    });
  });

  it("prefers revocation over signature verification", async () => {
    await withVerifier(trustedKeys("REVOKED"), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      const tampered = { ...signed, signature: tamperSignature(signed.signature) };
      expect(verifier.verify(tampered, BINDING).decision).toBe("SIGNING_KEY_REVOKED");
    });
  });
});

// ── Tiempo (9-14) ────────────────────────────────────────────────────────────

describe("SessionAssertionVerifier — ventana temporal", () => {
  it("rejects an assertion before issued_at", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-02T23:59:59Z"), (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("NOT_YET_VALID");
    });
  });

  it("accepts the exact issuing instant", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-03T00:00:00Z"), (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("VALID");
    });
  });

  it("accepts the instant immediately before expiry", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-03T23:59:59.999Z"), (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("VALID");
    });
  });

  it("treats the exact expiry instant as expired", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-04T00:00:00Z"), (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("EXPIRED");
    });
  });

  it("rejects an assertion after expiry", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-05T00:00:00Z"), (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("EXPIRED");
    });
  });

  it("grants no grace after expiry", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-04T00:00:01Z"), (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("EXPIRED");
    });
  });

  it("rejects a clock rolled back beyond the trusted tolerance", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const clock = new TrustedClockGuard(database);
      clock.accept(new Date("2026-09-05T00:00:00Z"));
      const verifier = new SessionAssertionVerifier(
        trustedKeys(),
        clock,
        () => new Date("2026-09-03T12:00:00Z"),
      );
      expect(() => verifier.verify(signWithTestKey(claims()), BINDING)).toThrow(/clock rollback/);
    } finally {
      database.close();
    }
  });

  it("does not let a rollback revive an assertion that already expired", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const clock = new TrustedClockGuard(database);
      // El reloj avanzó más allá de la expiración y quedó registrado.
      const expired = new SessionAssertionVerifier(trustedKeys(), clock, () => new Date("2026-09-05T00:00:00Z"));
      expect(expired.verify(signWithTestKey(claims()), BINDING).decision).toBe("EXPIRED");
      // Retroceder dentro de la ventana ya no es aceptable.
      const rolledBack = new SessionAssertionVerifier(trustedKeys(), clock, () => INSIDE_WINDOW);
      expect(() => rolledBack.verify(signWithTestKey(claims()), BINDING)).toThrow(/clock rollback/);
    } finally {
      database.close();
    }
  });
});

// ── Binding (15-19) ──────────────────────────────────────────────────────────

describe("SessionAssertionVerifier — binding", () => {
  it("accepts the expected binding", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("VALID");
    });
  });

  it("rejects an assertion issued for another user", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), { ...BINDING, userId: OTHER }).decision)
        .toBe("BINDING_MISMATCH");
    });
  });

  it("rejects an assertion issued for another installation", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), { ...BINDING, installationId: OTHER }).decision)
        .toBe("BINDING_MISMATCH");
    });
  });

  it("rejects an assertion issued for another device", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), { ...BINDING, deviceId: OTHER }).decision)
        .toBe("BINDING_MISMATCH");
    });
  });

  it("rejects an incomplete expected context instead of comparing against a blank", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      for (const field of ["userId", "installationId", "deviceId"] as const) {
        expect(() => verifier.verify(signWithTestKey(claims()), { ...BINDING, [field]: "" }))
          .toThrow(/expected session binding requires/);
      }
    });
  });

  it("rejects an expected context whose field is only whitespace", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(() => verifier.verify(signWithTestKey(claims()), { ...BINDING, userId: "   " }))
        .toThrow(/expected session binding requires/);
    });
  });

  it("returns claims on a binding mismatch because the signature was already proven", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims()), { ...BINDING, userId: OTHER });
      expect(result.claims?.user_id).toBe(USER);
    });
  });
});

// ── Sequence (20-24) ─────────────────────────────────────────────────────────

describe("SessionAssertionVerifier — sequence", () => {
  it("accepts a valid sequence when no baseline is supplied", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims({ sequence: 7 })), BINDING).decision).toBe("VALID");
    });
  });

  it("rejects a sequence equal to the highest accepted one", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims({ sequence: 5 })), BINDING, {
        highestAcceptedSequence: 5,
      });
      expect(result.decision).toBe("SEQUENCE_REPLAY");
    });
  });

  it("rejects a lower sequence", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims({ sequence: 4 })), BINDING, {
        highestAcceptedSequence: 9,
      }).decision).toBe("SEQUENCE_REPLAY");
    });
  });

  it("accepts a strictly greater sequence", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims({ sequence: 10 })), BINDING, {
        highestAcceptedSequence: 9,
      }).decision).toBe("VALID");
    });
  });

  it("evaluates the sequence only after signature, binding and window", async () => {
    await withVerifier(trustedKeys(), new Date("2026-09-05T00:00:00Z"), (verifier) => {
      // Expirada y además con secuencia reproducida: se reporta la expiración.
      const result = verifier.verify(signWithTestKey(claims({ sequence: 1 })), BINDING, {
        highestAcceptedSequence: 5,
      });
      expect(result.decision).toBe("EXPIRED");
    });
  });

  it("persists no state: repeated verification of the same assertion is stable", async () => {
    const dataDirectory = await directory();
    const database = LocalDatabase.open({ dataDirectory });
    try {
      const verifier = new SessionAssertionVerifier(
        trustedKeys(),
        new TrustedClockGuard(database),
        () => INSIDE_WINDOW,
      );
      const signed = signWithTestKey(claims({ sequence: 3 }));
      expect(verifier.verify(signed, BINDING).decision).toBe("VALID");
      // Sin store, la segunda verificación es idéntica: el anti-replay
      // persistente pertenece al bloque de persistencia posterior.
      expect(verifier.verify(signed, BINDING).decision).toBe("VALID");

      // La tabla de sesión existe en el esquema desde SSA-003, pero el
      // verificador no escribe en ella: lo que se afirma es la ausencia de
      // filas, no la ausencia de la tabla.
      const rows = database.native
        .prepare("SELECT COUNT(*) AS total FROM local_session_assertion")
        .get() as { total: number };
      expect(rows.total).toBe(0);
    } finally {
      database.close();
    }
  });
});

// ── Separación identidad / autorización (25-28) ──────────────────────────────

describe("SessionAssertionVerifier — identidad no es autorización", () => {
  it("a valid assertion yields no permissions", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims()), BINDING);
      expect(result.decision).toBe("VALID");
      const keys = Object.keys(result.claims ?? {});
      for (const forbidden of ["permissions", "assignments", "roles", "scopes", "entitlements"]) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

  it("a valid assertion carries no tenant, company or branch authorization", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const keys = Object.keys(verifier.verify(signWithTestKey(claims()), BINDING).claims ?? {});
      expect(keys).not.toContain("tenant_id");
      expect(keys).not.toContain("company_id");
      expect(keys).not.toContain("branch_id");
      expect(keys).not.toContain("cash_register_id");
    });
  });

  it("the result exposes only a decision, claims and the evaluation instant", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims()), BINDING);
      expect(Object.keys(result).sort()).toEqual(["claims", "decision", "evaluatedAt"]);
    });
  });

  it("exposes no key material in the result", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const serialised = JSON.stringify(verifier.verify(signWithTestKey(claims()), BINDING));
      expect(serialised).not.toContain("PRIVATE");
      expect(serialised).not.toContain("BEGIN");
    });
  });

  /**
   * Invariante estructural: el módulo no puede razonar sobre autorización ni
   * sobre Cash, y la única forma de garantizarlo es que no los importe.
   */
  it("does not import the authorization engine, a store, or anything about cash", async () => {
    const source = await readFile(
      new URL("../src/security/session-assertion-verifier.ts", import.meta.url),
      "utf8",
    );

    // Se comprueban los especificadores de import reales, no la prosa: un
    // comentario que explique que algo NO se usa no debe hacer fallar el test.
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers).toEqual([
      "node:crypto",
      "@pos-platform/contracts",
      "../channel/canonical-json.js",
      "./trusted-clock.js",
      "./license-verifier.js",
    ]);

    // Y sobre el código ejecutable, sin comentarios, que no se invoque el motor
    // de autorización ni se nombre ningún concepto comercial.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const forbidden of ["evaluatePermission", "cash", "Cash", "authorization-snapshot"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

// ── Fail closed (29-33) ──────────────────────────────────────────────────────

describe("SessionAssertionVerifier — fail closed", () => {
  it("rejects a payload that is not a signed session assertion", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(() => verifier.verify({ nope: true }, BINDING)).toThrow();
    });
  });

  it("rejects a missing signature", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(() => verifier.verify({ claims: claims() }, BINDING)).toThrow();
    });
  });

  it("rejects a malformed signature", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(() => verifier.verify({ claims: claims(), signature: "short" }, BINDING)).toThrow();
      expect(() => verifier.verify({ claims: claims(), signature: `${"a".repeat(85)}+` }, BINDING))
        .toThrow();
    });
  });

  it("rejects missing claims", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(() => verifier.verify({ signature: "a".repeat(86) }, BINDING)).toThrow();
    });
  });

  it("rejects incomplete claims", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const partial = { ...claims() } as Record<string, unknown>;
      delete partial.device_id;
      expect(() => verifier.verify({ claims: partial, signature: "a".repeat(86) }, BINDING)).toThrow();
    });
  });

  it("rejects unexpected fields in the envelope", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      expect(() => verifier.verify({ ...signed, algorithm: "ED25519" }, BINDING)).toThrow();
    });
  });

  it("rejects an inverted validity window before verifying anything", async () => {
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      const signed = signWithTestKey(claims());
      const broken = {
        claims: { ...signed.claims, offline_valid_until: "2026-09-02T00:00:00Z" },
        signature: signed.signature,
      };
      expect(() => verifier.verify(broken, BINDING)).toThrow();
    });
  });

  it("turns an unusable key into a denial instead of a crash", async () => {
    // Material de clave inutilizable: `crypto.verify` lanza, y el verificador
    // debe traducirlo a firma no probada, no propagar la excepción.
    const brokenKey = { key: {} as never, status: "ACTIVE" as const };
    const keys = new Map<string, TrustedSigningKey>([[KEY_ID, brokenKey]]);
    await withVerifier(keys, INSIDE_WINDOW, (verifier) => {
      const result = verifier.verify(signWithTestKey(claims()), BINDING);
      expect(result.decision).toBe("SIGNATURE_INVALID");
      expect(result.claims).toBeNull();
    });
  });

  it("denies with an empty trust store", async () => {
    await withVerifier(new Map(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify(signWithTestKey(claims()), BINDING).decision).toBe("SIGNATURE_INVALID");
    });
  });
});

describe("unsignedSessionAssertionBytes", () => {
  it("produces the exact bytes covered by the signature", async () => {
    const value = claims();
    const signature = sign(null, unsignedSessionAssertionBytes(value), testOnlyKeyPair.privateKey)
      .toString("base64url");
    await withVerifier(trustedKeys(), INSIDE_WINDOW, (verifier) => {
      expect(verifier.verify({ claims: value, signature }, BINDING).decision).toBe("VALID");
    });
  });

  it("is stable regardless of property order", () => {
    const value = claims();
    const reordered = Object.fromEntries(
      Object.entries(value).reverse(),
    ) as unknown as SessionAssertionClaims;
    expect(unsignedSessionAssertionBytes(reordered).toString())
      .toBe(unsignedSessionAssertionBytes(value).toString());
  });

  it("changes when any claim changes", () => {
    const base = unsignedSessionAssertionBytes(claims()).toString();
    expect(unsignedSessionAssertionBytes(claims({ sequence: 2 })).toString()).not.toBe(base);
  });
});
