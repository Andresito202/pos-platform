import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { NativeAuthorizationCodeExchange } from "../src/native-authorization-code-exchange.js";
import { IsolatedPostgresNativeCodeConsumer } from "../src/isolated-postgres-native-code-consumer.js";
import { derivePkceS256Challenge } from "../src/native-authorization-constraints.js";
import { inspectNativeAuthorizationCallback } from "../src/native-authorization-callback.js";

const base = process.env.POSTGRES_TEST_URL;
const suite = base ? describe : describe.skip;
const name = "pos_native_code_test_" + randomBytes(8).toString("hex");
const registration = Object.freeze({
  clientId: "desktop",
  redirectUri: "http://127.0.0.1:42133/callback",
  authorizationOrigin: "https://login.example.com",
});
const state = "S".repeat(43);
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

suite("native callback + PKCE exchange + PostgreSQL — physical composition", () => {
  let admin: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    if (!base) throw new Error("TEST_URL_REQUIRED");
    const uri = new URL(base);
    if (!["localhost", "127.0.0.1"].includes(uri.hostname) ||
      uri.port !== "55433" || uri.pathname !== "/pos_target_test")
      throw new Error("NATIVE_CODE_PHYSICAL_TEST_URL_MUST_BE_LOCAL_FIXTURE");
    admin = new Pool({ connectionString: base });
    await admin.query(`CREATE DATABASE "${name}"`);
    uri.pathname = "/" + name;
    runtime = new Pool({ connectionString: uri.href, max: 8 });
    const fixture = readFileSync(
      new URL("../../../tools/target-migrations/sql/postgres/native-authorization-code-isolated-fixture.sql", import.meta.url),
      "utf8",
    );
    await runtime.query(fixture);
  }, 20_000);

  afterAll(async () => {
    await runtime?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  }, 20_000);

  async function issue(code: string, options: { expiresSeconds?: number; challenge?: string; state?: string; clientId?: string } = {}) {
    await runtime.query(`INSERT INTO identity.native_authorization_code_validation
      (code_hash,client_id,redirect_uri,code_challenge,state,trusted_binding_id,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()-interval '2 minutes',
        clock_timestamp()+($7::int * interval '1 second'))`, [
      createHash("sha256").update(code).digest("hex"),
      options.clientId ?? registration.clientId,
      registration.redirectUri,
      options.challenge ?? derivePkceS256Challenge(verifier),
      options.state ?? state,
      "trusted-fixture",
      options.expiresSeconds ?? 60,
    ]);
  }

  function exchange() {
    const consumer = new IsolatedPostgresNativeCodeConsumer(
      runtime,
      async (bindingId: string) => Object.freeze({ bindingId, source: "FIXTURE_ONLY" as const }),
    );
    return new NativeAuthorizationCodeExchange(registration, consumer);
  }

  function callback(code: string, callbackState = state) {
    return inspectNativeAuthorizationCallback(
      registration.redirectUri + "?code=" + code + "&state=" + callbackState,
      { registration, state },
    );
  }

  it("accepts the original callback and PKCE evidence exactly once under concurrent exchanges", async () => {
    const code = "G".repeat(48);
    await issue(code);
    const candidate = callback(code);
    expect(candidate).toEqual({ code, clientId: registration.clientId });
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      exchange().exchange({ code: candidate!.code, state, verifier }),
    ));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(Boolean)[0]).toEqual({ bindingId: "trusted-fixture", source: "FIXTURE_ONLY" });
    expect(await exchange().exchange({ code, state, verifier })).toBeNull();
  });

  it("rejects a tampered callback before touching PostgreSQL", async () => {
    const code = "H".repeat(48);
    await issue(code);
    expect(callback(code, "X".repeat(43))).toBeNull();
    const row = await runtime.query<{ consumed_at: Date | null }>(
      "SELECT consumed_at FROM identity.native_authorization_code_validation WHERE code_hash=$1",
      [createHash("sha256").update(code).digest("hex")],
    );
    expect(row.rows[0]?.consumed_at).toBeNull();
  });

  it("burns a live code on incorrect PKCE and rejects the subsequent correct verifier", async () => {
    const code = "I".repeat(48);
    await issue(code);
    expect(await exchange().exchange({ code, state, verifier: "Q".repeat(43) })).toBeNull();
    expect(await exchange().exchange({ code, state, verifier })).toBeNull();
  });

  it("burns a live code when the persisted client binding is wrong", async () => {
    const code = "J".repeat(48);
    await issue(code, { clientId: "other-client" });
    expect(await exchange().exchange({ code, state, verifier })).toBeNull();
    expect(await exchange().exchange({ code, state, verifier })).toBeNull();
  });

  it("rejects expired grants at PostgreSQL time", async () => {
    const code = "K".repeat(48);
    await issue(code, { expiresSeconds: -1 });
    expect(await exchange().exchange({ code, state, verifier })).toBeNull();
  });
});
