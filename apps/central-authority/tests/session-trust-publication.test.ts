import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionTrustPublication } from "../src/session-trust-publication.js";

describe("SessionTrustPublication", () => {
  it("loads only a schema-valid signed trust bundle", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-session-trust-"));
    const path = join(directory, "bundle.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      keys: [{
        claims: {
          key_id: "SSA-CI-01",
          key_purpose: "SESSION_ASSERTION",
          environment: "PRODUCTION",
          public_key_pem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAuzra6on92WSA0WExaDPQ1GSYi2RqyUSPdbHRCtuQNH0=\n-----END PUBLIC KEY-----\n",
          status: "ACTIVE",
          valid_from: "2026-01-01T00:00:00.000Z",
          valid_until: null,
          version: 1,
        },
        signature: "1s6EFqqMHkg3UMNIFTOywsJ_JSSIwLhgwbG3W91PdXWOhOEwq1abR8LzcjkBLFWeVyTtZmTQII0yKC9xPFpoCQ",
      }],
    }));
    expect(new SessionTrustPublication(path).load().keys).toHaveLength(1);
  });

  it("fails closed on malformed publication", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-session-trust-"));
    const path = join(directory, "bundle.json");
    writeFileSync(path, JSON.stringify({ version: 1, keys: [] }));
    expect(() => new SessionTrustPublication(path).load()).toThrow();
  });
});
