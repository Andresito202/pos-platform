import { describe, expect, it } from "vitest";
import {
  REQUIRED_RELEASE_COMPONENTS,
  ReleaseManifestSchema,
  evaluateRollback,
  evaluateUpgrade,
  findReleaseArtifact,
  releaseComponentVersion,
  type ReleaseComponent,
  type ReleaseManifest,
  type VerifiedArtifact,
} from "../src/index.js";

const digest: Record<ReleaseComponent, string> = {
  DESKTOP_APP: "a".repeat(64),
  LOCAL_SERVICE: "b".repeat(64),
  LOCAL_SCHEMA: "c".repeat(64),
  CONTRACTS: "d".repeat(64),
};

const SIZE = 1_000;

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return ReleaseManifestSchema.parse({
    manifest_version: "1",
    release_version: "2.0.0",
    released_at: "2026-09-03T00:00:00Z",
    artifacts: REQUIRED_RELEASE_COMPONENTS.map((component) => ({
      component,
      version: "2.0.0",
      sha256: digest[component],
      size_bytes: SIZE,
    })),
    supported_local_schema: { min: "1.0.0", max: "2.0.0" },
    signature: { algorithm: "ED25519", key_id: "CAMACHO_POS_RELEASE", value: "c2ln" },
    ...overrides,
  });
}

function verifiedAll(): VerifiedArtifact[] {
  return REQUIRED_RELEASE_COMPONENTS.map((component) => ({
    component,
    sha256: digest[component],
    size_bytes: SIZE,
  }));
}

const TRUSTED = ["CAMACHO_POS_RELEASE"] as const;
const TOTAL_BYTES = SIZE * REQUIRED_RELEASE_COMPONENTS.length;

function upgradeInput(overrides: Record<string, unknown> = {}) {
  return {
    manifest: manifest(),
    installed: { release_version: "1.0.0", local_schema_version: "1.0.0" },
    trusted_signing_key_ids: TRUSTED,
    verified_artifacts: verifiedAll(),
    available_bytes: TOTAL_BYTES,
    ...overrides,
  };
}

describe("ReleaseManifestSchema", () => {
  it("accepts a manifest declaring every required component", () => {
    expect(manifest().artifacts).toHaveLength(REQUIRED_RELEASE_COMPONENTS.length);
  });

  it("requires explicit versions for desktop, service, schema and contracts", () => {
    const parsed = manifest();
    for (const component of REQUIRED_RELEASE_COMPONENTS) {
      expect(releaseComponentVersion(parsed, component)).toBe("2.0.0");
    }
  });

  it("rejects a manifest missing a required component", () => {
    const artifacts = manifest().artifacts.filter((a) => a.component !== "LOCAL_SCHEMA");
    expect(() => ReleaseManifestSchema.parse({ ...manifest(), artifacts })).toThrow();
  });

  it("rejects duplicated components instead of silently taking one", () => {
    const first = manifest().artifacts[0]!;
    expect(() =>
      ReleaseManifestSchema.parse({ ...manifest(), artifacts: [first, first, first, first] }),
    ).toThrow();
  });

  it("rejects a weaker digest algorithm by rejecting malformed sha256", () => {
    const artifacts = manifest().artifacts.map((a, index) =>
      index === 0 ? { ...a, sha256: "deadbeef" } : a,
    );
    expect(() => ReleaseManifestSchema.parse({ ...manifest(), artifacts })).toThrow();
  });

  it("rejects an inverted supported schema range", () => {
    expect(() =>
      ReleaseManifestSchema.parse({
        ...manifest(),
        supported_local_schema: { min: "3.0.0", max: "1.0.0" },
      }),
    ).toThrow();
  });

  it("exposes artifacts by component and undefined for a missing lookup", () => {
    expect(findReleaseArtifact(manifest(), "DESKTOP_APP")?.sha256).toBe(digest.DESKTOP_APP);
  });
});

describe("evaluateUpgrade — DEC-010 regla 2 (firma obligatoria)", () => {
  it("allows a fully valid signed upgrade", () => {
    expect(evaluateUpgrade(upgradeInput())).toEqual({ decision: "ALLOW", reasons: [] });
  });

  it("rejects an unsigned release", () => {
    const result = evaluateUpgrade(upgradeInput({ manifest: manifest({ signature: null }) }));
    expect(result.decision).toBe("REJECT");
    expect(result.reasons).toContain("UNSIGNED_RELEASE");
  });

  it("rejects a release signed by an untrusted key", () => {
    const result = evaluateUpgrade(upgradeInput({ trusted_signing_key_ids: ["OTRA_CLAVE"] }));
    expect(result.reasons).toContain("UNTRUSTED_SIGNING_KEY");
  });

  it("does not report an untrusted key when the release is simply unsigned", () => {
    const result = evaluateUpgrade(upgradeInput({ manifest: manifest({ signature: null }) }));
    expect(result.reasons).not.toContain("UNTRUSTED_SIGNING_KEY");
  });
});

describe("evaluateUpgrade — DEC-010 regla 3 (integridad y espacio)", () => {
  it("rejects a checksum mismatch", () => {
    const tampered = verifiedAll().map((a, i) => (i === 0 ? { ...a, sha256: "f".repeat(64) } : a));
    expect(evaluateUpgrade(upgradeInput({ verified_artifacts: tampered })).reasons)
      .toContain("CHECKSUM_MISMATCH");
  });

  it("rejects a size mismatch even when the digest matches", () => {
    const tampered = verifiedAll().map((a, i) => (i === 0 ? { ...a, size_bytes: 1 } : a));
    const result = evaluateUpgrade(upgradeInput({ verified_artifacts: tampered }));
    expect(result.reasons).toContain("ARTIFACT_SIZE_MISMATCH");
    expect(result.reasons).not.toContain("CHECKSUM_MISMATCH");
  });

  it("rejects when an artifact was never physically verified", () => {
    const partial = verifiedAll().filter((a) => a.component !== "CONTRACTS");
    expect(evaluateUpgrade(upgradeInput({ verified_artifacts: partial })).reasons)
      .toContain("MISSING_VERIFIED_ARTIFACT");
  });

  it("rejects when available space is below the declared total", () => {
    expect(evaluateUpgrade(upgradeInput({ available_bytes: TOTAL_BYTES - 1 })).reasons)
      .toContain("INSUFFICIENT_DISK_SPACE");
  });

  it("allows when available space exactly matches the requirement", () => {
    expect(evaluateUpgrade(upgradeInput({ available_bytes: TOTAL_BYTES })).decision).toBe("ALLOW");
  });
});

describe("evaluateUpgrade — compatibilidad de esquema y dirección", () => {
  it("rejects an installed schema outside the supported range", () => {
    const input = upgradeInput({
      installed: { release_version: "1.0.0", local_schema_version: "3.0.0" },
    });
    expect(evaluateUpgrade(input).reasons).toContain("SCHEMA_INCOMPATIBLE");
  });

  it("rejects reinstalling the same release version as an upgrade", () => {
    const input = upgradeInput({
      installed: { release_version: "2.0.0", local_schema_version: "1.0.0" },
    });
    expect(evaluateUpgrade(input).reasons).toContain("NOT_AN_UPGRADE");
  });

  it("rejects a downgrade presented as an upgrade", () => {
    const input = upgradeInput({
      installed: { release_version: "3.0.0", local_schema_version: "1.0.0" },
    });
    expect(evaluateUpgrade(input).reasons).toContain("NOT_AN_UPGRADE");
  });

  it("accumulates every failure instead of stopping at the first", () => {
    const input = upgradeInput({
      manifest: manifest({ signature: null }),
      installed: { release_version: "9.0.0", local_schema_version: "9.9.9" },
      available_bytes: 0,
    });
    const result = evaluateUpgrade(input);
    expect(result.reasons).toEqual(
      [...result.reasons].sort(),
    );
    expect(new Set(result.reasons)).toEqual(
      new Set(["UNSIGNED_RELEASE", "NOT_AN_UPGRADE", "SCHEMA_INCOMPATIBLE", "INSUFFICIENT_DISK_SPACE"]),
    );
  });
});

describe("evaluateRollback — DEC-010 regla 7 (compatibilidad de esquema)", () => {
  const target = manifest({
    release_version: "1.0.0",
    supported_local_schema: { min: "1.0.0", max: "1.0.0" },
  });

  function rollbackInput(overrides: Record<string, unknown> = {}) {
    return {
      target,
      installed: { release_version: "2.0.0", local_schema_version: "1.0.0" },
      trusted_signing_key_ids: TRUSTED,
      verified_artifacts: verifiedAll(),
      ...overrides,
    };
  }

  it("allows a rollback when the target supports the installed schema", () => {
    expect(evaluateRollback(rollbackInput())).toEqual({ decision: "ALLOW", reasons: [] });
  });

  it("rejects a rollback when the schema already migrated beyond the target", () => {
    const input = rollbackInput({
      installed: { release_version: "2.0.0", local_schema_version: "2.0.0" },
    });
    const result = evaluateRollback(input);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons).toContain("SCHEMA_INCOMPATIBLE");
  });

  it("rejects an unsigned rollback target", () => {
    const unsigned = manifest({
      release_version: "1.0.0",
      supported_local_schema: { min: "1.0.0", max: "1.0.0" },
      signature: null,
    });
    expect(evaluateRollback(rollbackInput({ target: unsigned })).reasons)
      .toContain("UNSIGNED_RELEASE");
  });

  it("rejects a tampered rollback artifact", () => {
    const tampered = verifiedAll().map((a, i) => (i === 1 ? { ...a, sha256: "e".repeat(64) } : a));
    expect(evaluateRollback(rollbackInput({ verified_artifacts: tampered })).reasons)
      .toContain("CHECKSUM_MISMATCH");
  });

  it("rejects a forward move disguised as a rollback", () => {
    const input = rollbackInput({
      installed: { release_version: "1.0.0", local_schema_version: "1.0.0" },
    });
    expect(evaluateRollback(input).reasons).toContain("NOT_A_ROLLBACK");
  });

  it("treats an equal version as not a rollback", () => {
    const input = rollbackInput({
      installed: { release_version: "1.0.0", local_schema_version: "1.0.0" },
    });
    expect(evaluateRollback(input).decision).toBe("REJECT");
  });

  it("never allows a rollback on any rejection reason (fail-closed)", () => {
    const input = rollbackInput({
      installed: { release_version: "2.0.0", local_schema_version: "2.0.0" },
      trusted_signing_key_ids: ["CLAVE_DESCONOCIDA"],
    });
    const result = evaluateRollback(input);
    expect(result.decision).toBe("REJECT");
    expect(result.reasons.length).toBeGreaterThan(1);
  });
});
