import { describe, expect, it } from "vitest";
import {
  SessionAssertionClaimsSchema,
  SignedSessionAssertionSchema,
  type SessionAssertionClaims,
} from "../src/index.js";

const SESSION = "018f0000-0000-7000-8000-0000000000b0";
const USER = "018f0000-0000-7000-8000-0000000000a1";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a2";
const DEVICE = "018f0000-0000-7000-8000-0000000000a3";

const SIGNATURE = "a".repeat(86);

function claims(overrides: Record<string, unknown> = {}): unknown {
  return {
    session_id: SESSION,
    user_id: USER,
    tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    issued_at: "2026-09-03T00:00:00Z",
    offline_valid_until: "2026-09-04T00:00:00Z",
    sequence: 1,
    key_id: "SESSION_KEY_1",
    ...overrides,
  };
}

/** Omite una clave del objeto base, para probar cada campo obligatorio. */
function withoutField(field: string): unknown {
  const value = claims() as Record<string, unknown>;
  delete value[field];
  return value;
}

const REQUIRED_FIELDS = [
  "session_id",
  "user_id",
  "tenant_membership_id",
  "installation_id",
  "device_id",
  "issued_at",
  "offline_valid_until",
  "sequence",
  "key_id",
] as const;

describe("SessionAssertionClaimsSchema — claims válidos", () => {
  it("accepts a complete session assertion", () => {
    const parsed = SessionAssertionClaimsSchema.parse(claims()) as SessionAssertionClaims;
    expect(parsed.session_id).toBe(SESSION);
    expect(parsed.user_id).toBe(USER);
    expect(parsed.tenant_membership_id).toBe(MEMBERSHIP);
  });

  it("normalises uppercase uuids to lowercase", () => {
    const parsed = SessionAssertionClaimsSchema.parse(
      claims({ session_id: SESSION.toUpperCase() }),
    ) as SessionAssertionClaims;
    expect(parsed.session_id).toBe(SESSION);
  });

  it("exposes exactly the nine agreed claims and nothing else", () => {
    const parsed = SessionAssertionClaimsSchema.parse(claims()) as SessionAssertionClaims;
    expect(Object.keys(parsed).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });
});

describe("SessionAssertionClaimsSchema — campos obligatorios", () => {
  for (const field of REQUIRED_FIELDS) {
    it(`rejects claims missing ${field}`, () => {
      expect(() => SessionAssertionClaimsSchema.parse(withoutField(field))).toThrow();
    });
  }

  it("rejects an entirely empty payload", () => {
    expect(() => SessionAssertionClaimsSchema.parse({})).toThrow();
  });
});

describe("SessionAssertionClaimsSchema — tipos incorrectos", () => {
  it("rejects a numeric session_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ session_id: 12345 }))).toThrow();
  });

  it("rejects a string sequence", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ sequence: "1" }))).toThrow();
  });

  it("rejects a numeric key_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ key_id: 1 }))).toThrow();
  });

  it("rejects a null user_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ user_id: null }))).toThrow();
  });

  it("rejects an object where a timestamp is expected", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ issued_at: {} }))).toThrow();
  });
});

describe("SessionAssertionClaimsSchema — identificadores vacíos o inválidos", () => {
  for (const field of ["session_id", "user_id", "tenant_membership_id", "installation_id", "device_id"]) {
    it(`rejects an empty ${field}`, () => {
      expect(() => SessionAssertionClaimsSchema.parse(claims({ [field]: "" }))).toThrow();
    });

    it(`rejects a non-uuid ${field}`, () => {
      expect(() => SessionAssertionClaimsSchema.parse(claims({ [field]: "not-a-uuid" }))).toThrow();
    });
  }

  it("rejects a whitespace-only identifier", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ user_id: "   " }))).toThrow();
  });
});

describe("SessionAssertionClaimsSchema — binding incompleto", () => {
  it("rejects an assertion without installation_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(withoutField("installation_id"))).toThrow();
  });

  it("rejects an assertion without device_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(withoutField("device_id"))).toThrow();
  });

  it("rejects an assertion without user_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(withoutField("user_id"))).toThrow();
  });

  it("keeps the three binding identifiers independent", () => {
    const parsed = SessionAssertionClaimsSchema.parse(claims()) as SessionAssertionClaims;
    expect(new Set([parsed.user_id, parsed.installation_id, parsed.device_id]).size).toBe(3);
  });
});

describe("SessionAssertionClaimsSchema — timestamps", () => {
  it("rejects a non-ISO issued_at", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ issued_at: "03/09/2026" }))).toThrow();
  });

  it("rejects a timestamp without the UTC marker", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ issued_at: "2026-09-03T00:00:00" })))
      .toThrow();
  });

  it("rejects a timestamp with a numeric offset instead of Z", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ issued_at: "2026-09-03T00:00:00-05:00" })))
      .toThrow();
  });

  it("accepts fractional seconds", () => {
    const parsed = SessionAssertionClaimsSchema.parse(
      claims({ issued_at: "2026-09-03T00:00:00.500Z" }),
    ) as SessionAssertionClaims;
    expect(parsed.issued_at).toBe("2026-09-03T00:00:00.500Z");
  });

  it("rejects a null offline_valid_until, because a session is never perpetual", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ offline_valid_until: null }))).toThrow();
  });
});

describe("SessionAssertionClaimsSchema — ventana de vigencia", () => {
  it("rejects offline_valid_until earlier than issued_at", () => {
    expect(() => SessionAssertionClaimsSchema.parse(
      claims({ offline_valid_until: "2026-09-02T00:00:00Z" }),
    )).toThrow();
  });

  it("rejects offline_valid_until equal to issued_at", () => {
    expect(() => SessionAssertionClaimsSchema.parse(
      claims({ offline_valid_until: "2026-09-03T00:00:00Z" }),
    )).toThrow();
  });

  it("accepts a window of a single second", () => {
    const parsed = SessionAssertionClaimsSchema.parse(
      claims({ offline_valid_until: "2026-09-03T00:00:01Z" }),
    ) as SessionAssertionClaims;
    expect(parsed.offline_valid_until).toBe("2026-09-03T00:00:01Z");
  });

  it("does not impose any maximum duration, because the ceiling is versioned policy", () => {
    const parsed = SessionAssertionClaimsSchema.parse(
      claims({ offline_valid_until: "2031-09-03T00:00:00Z" }),
    ) as SessionAssertionClaims;
    expect(parsed.offline_valid_until).toBe("2031-09-03T00:00:00Z");
  });

  it("reports the violation on the offline_valid_until path", () => {
    const result = SessionAssertionClaimsSchema.safeParse(
      claims({ offline_valid_until: "2026-09-02T00:00:00Z" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("offline_valid_until"))).toBe(true);
    }
  });
});

describe("SessionAssertionClaimsSchema — sequence", () => {
  it("rejects a zero sequence", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ sequence: 0 }))).toThrow();
  });

  it("rejects a negative sequence", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ sequence: -1 }))).toThrow();
  });

  it("rejects a fractional sequence", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ sequence: 1.5 }))).toThrow();
  });

  it("rejects a sequence beyond the safe integer range", () => {
    expect(() => SessionAssertionClaimsSchema.parse(
      claims({ sequence: Number.MAX_SAFE_INTEGER + 2 }),
    )).toThrow();
  });

  it("accepts the maximum safe integer", () => {
    const parsed = SessionAssertionClaimsSchema.parse(
      claims({ sequence: Number.MAX_SAFE_INTEGER }),
    ) as SessionAssertionClaims;
    expect(parsed.sequence).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("SessionAssertionClaimsSchema — key_id", () => {
  it("rejects a key_id starting with a digit", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ key_id: "1session_key_1" }))).toThrow();
  });

  it("rejects a key_id with spaces", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ key_id: "SESSION KEY 1" }))).toThrow();
  });

  it("rejects an empty key_id", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ key_id: "" }))).toThrow();
  });

  it("accepts a dotted stable code", () => {
    const parsed = SessionAssertionClaimsSchema.parse(
      claims({ key_id: "SESSION.KEY.1" }),
    ) as SessionAssertionClaims;
    expect(parsed.key_id).toBe("SESSION.KEY.1");
  });
});

describe("SessionAssertionClaimsSchema — campos inesperados", () => {
  it("rejects an unknown field", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ nickname: "caja-1" }))).toThrow();
  });

  it("rejects a presence proof smuggled into the claims", () => {
    expect(() => SessionAssertionClaimsSchema.parse(claims({ presence_proof: "abc" }))).toThrow();
  });

  it("rejects an authorization policy version, which this contract does not carry", () => {
    expect(() => SessionAssertionClaimsSchema.parse(
      claims({ authorization_policy_version_id: MEMBERSHIP }),
    )).toThrow();
  });
});

/**
 * La SSA responde a "quién es el operador". Que no pueda transportar
 * autorización no es una convención: `strictObject` lo hace estructuralmente
 * imposible, de modo que no puede convertirse en una segunda autoridad.
 */
describe("SessionAssertionClaimsSchema — ausencia de autorización implícita", () => {
  for (const field of [
    "permissions",
    "assignments",
    "roles",
    "role_status",
    "scopes",
    "company_scopes",
    "branch_scopes",
    "entitlements",
    "cash_register_id",
  ]) {
    it(`rejects ${field} inside a session assertion`, () => {
      expect(() => SessionAssertionClaimsSchema.parse(claims({ [field]: [] }))).toThrow();
    });
  }

  for (const field of ["password", "refresh_token", "access_token", "mfa_secret", "credential"]) {
    it(`rejects ${field}, which must never reach the local runtime`, () => {
      expect(() => SessionAssertionClaimsSchema.parse(claims({ [field]: "x" }))).toThrow();
    });
  }

  it("carries no tenant, company or branch of its own", () => {
    const parsed = SessionAssertionClaimsSchema.parse(claims()) as SessionAssertionClaims;
    const keys = Object.keys(parsed);
    expect(keys).not.toContain("tenant_id");
    expect(keys).not.toContain("company_id");
    expect(keys).not.toContain("branch_id");
  });
});

describe("SignedSessionAssertionSchema — sobre", () => {
  it("accepts a well formed envelope", () => {
    const parsed = SignedSessionAssertionSchema.parse({ claims: claims(), signature: SIGNATURE });
    expect(parsed.signature).toBe(SIGNATURE);
  });

  it("rejects an envelope without a signature", () => {
    expect(() => SignedSessionAssertionSchema.parse({ claims: claims() })).toThrow();
  });

  it("rejects a non-string signature", () => {
    expect(() => SignedSessionAssertionSchema.parse({ claims: claims(), signature: 1 })).toThrow();
  });

  it("rejects a null signature", () => {
    expect(() => SignedSessionAssertionSchema.parse({ claims: claims(), signature: null })).toThrow();
  });

  it("rejects a signature that is too short", () => {
    expect(() => SignedSessionAssertionSchema.parse({ claims: claims(), signature: "a".repeat(79) }))
      .toThrow();
  });

  it("rejects a signature that is too long", () => {
    expect(() => SignedSessionAssertionSchema.parse({ claims: claims(), signature: "a".repeat(129) }))
      .toThrow();
  });

  it("rejects a signature outside the base64url alphabet", () => {
    expect(() => SignedSessionAssertionSchema.parse({
      claims: claims(),
      signature: `${"a".repeat(85)}+`,
    })).toThrow();
  });

  it("rejects an envelope without claims", () => {
    expect(() => SignedSessionAssertionSchema.parse({ signature: SIGNATURE })).toThrow();
  });

  it("rejects an unexpected field in the envelope", () => {
    expect(() => SignedSessionAssertionSchema.parse({
      claims: claims(),
      signature: SIGNATURE,
      algorithm: "ED25519",
    })).toThrow();
  });

  it("rejects invalid claims inside an otherwise valid envelope", () => {
    expect(() => SignedSessionAssertionSchema.parse({
      claims: claims({ sequence: 0 }),
      signature: SIGNATURE,
    })).toThrow();
  });

  it("validates structure only and never accepts a signature as proof", () => {
    // Una firma sintácticamente válida no acredita nada: la verificación
    // criptográfica pertenece a SSA-002.
    const parsed = SignedSessionAssertionSchema.parse({ claims: claims(), signature: SIGNATURE });
    expect(parsed.claims.session_id).toBe(SESSION);
  });
});
