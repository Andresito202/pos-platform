import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scryptSync, randomBytes } from "node:crypto";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LocalOperatorPasswordGate } from "../src/security/local-operator-password-gate.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fullStore(password: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "camacho-gate-"));
  dirs.push(dir);
  const path = join(dir, "accounts.v1.json");
  const accounts = (["admin.local", "supervisor.local", "cajero.local", "superadmin.local"] as const).map((username) => {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, Buffer.from(salt, "hex"), 64, {
      N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
    }).toString("hex");
    const role = username.startsWith("admin") ? "ADMINISTRADOR"
      : username.startsWith("supervisor") ? "SUPERVISOR"
      : username.startsWith("superadmin") ? "SUPERADMINISTRADOR"
      : "CAJERO";
    return { username, role, scheme: "scrypt-N32768-r8-p1-v1", salt, hash };
  });
  writeFileSync(path, JSON.stringify({ format: "CAMACHO_DEV_ACCOUNTS_V1", accounts }));
  return { dir, path };
}

describe("LocalOperatorPasswordGate clock rollback", () => {
  it("rate-limits when wall clock moves before the budget window start", async () => {
    const { dir, path } = fullStore("secret-pass");
    const db = LocalDatabase.open({ dataDirectory: dir });
    let now = 1_700_000_000_000;
    const gate = new LocalOperatorPasswordGate(db, path, () => now);
    const first = await gate.authenticate("cajero.local", "wrong");
    expect(first.status).toBe("DENIED");
    now = now - 60_000;
    const rolled = await gate.authenticate("cajero.local", "wrong");
    expect(rolled.status).toBe("RATE_LIMITED");
  });
});
