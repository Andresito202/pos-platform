import { describe, expect, it } from "vitest";
import {
  createPlatformPasswordVerifier,
  isSupportedPlatformPasswordVerifier,
  verifyPlatformPasswordVerifier,
} from "../src/platform-password-verifier.js";

describe("platform PASSWORD verifier preparation (no production policy selected)", () => {
  it("creates a distinct versioned Argon2id PHC verifier and verifies the correct password", async () => {
    const password = "D3-verifier-fixture-only-contraseña";
    const first = await createPlatformPasswordVerifier(password, "owasp-19m-t2-p1");
    const second = await createPlatformPasswordVerifier(password, "owasp-19m-t2-p1");
    expect(first).toMatch(/^\$argon2id\$v=19\$/);
    expect(Object.fromEntries(first.split("$")[3]!.split(",").map(p => p.split("="))))
      .toEqual({ m: "19456", t: "2", p: "1" });
    expect(first).not.toBe(second);
    expect(isSupportedPlatformPasswordVerifier(first)).toBe(true);
    expect(await verifyPlatformPasswordVerifier(password, first)).toBe(true);
    expect(await verifyPlatformPasswordVerifier("wrong password", first)).toBe(false);
  });

  it("accepts an explicitly selected measured 64 MiB candidate", async () => {
    const verifier = await createPlatformPasswordVerifier("D3-strong-fixture", "candidate-64m-t3-p1");
    expect(verifier).toMatch(/^\$argon2id\$v=19\$/);
    expect(Object.fromEntries(verifier.split("$")[3]!.split(",").map(p => p.split("="))))
      .toEqual({ m: "65536", t: "3", p: "1" });
    expect(await verifyPlatformPasswordVerifier("D3-strong-fixture", verifier)).toBe(true);
  });

  it("rejects old, unrecognized, malformed, or excessive-cost hashes", async () => {
    for (const unsupported of [
      "plaintext", "$2b$12$legacy",
      "$argon2id$v=16$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0",
      "$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$ZGlnZXN0",
      "$argon2id$v=19$m=1048576,t=9,p=1$c2FsdA$ZGlnZXN0",
      "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0",
    ]) {
      expect(isSupportedPlatformPasswordVerifier(unsupported)).toBe(false);
      expect(await verifyPlatformPasswordVerifier("test", unsupported)).toBe(false);
    }
  });

  it("accepts either PHC parameter ordering but rejects duplicates and unbounded costs", () => {
    const suffix = "MTIzNDU2Nzg5MGFiY2RlZg$" + "Y".repeat(43);
    const base = "$argon2id$v=19$";
    expect(isSupportedPlatformPasswordVerifier(base + "m=19456,p=1,t=2$" + suffix)).toBe(true);
    expect(isSupportedPlatformPasswordVerifier(base + "t=2,m=19456,p=1$" + suffix)).toBe(true);
    expect(isSupportedPlatformPasswordVerifier(base + "m=19456,m=19456,p=1$" + suffix)).toBe(false);
    expect(isSupportedPlatformPasswordVerifier(base + "m=1048576,p=1,t=2$" + suffix)).toBe(false);
    expect(isSupportedPlatformPasswordVerifier(base + "m=19456,p=1,t=2,q=1$" + suffix)).toBe(false);
  });

  it("refuses to select a profile implicitly or accept an empty password", async () => {
    await expect(createPlatformPasswordVerifier("", "owasp-19m-t2-p1")).rejects.toThrow("PLATFORM_PASSWORD_EMPTY");
    await expect(createPlatformPasswordVerifier("test", "invented" as never))
      .rejects.toThrow("PLATFORM_PASSWORD_KDF_PROFILE_NOT_APPROVED");
  });
});
