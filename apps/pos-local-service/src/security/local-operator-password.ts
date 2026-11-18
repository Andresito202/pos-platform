import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

const roles = {
  "admin.local": "ADMINISTRADOR",
  "supervisor.local": "SUPERVISOR",
  "cajero.local": "CAJERO",
  "superadmin.local": "SUPERADMINISTRADOR",
} as const;

export type LocalOperator = {
  readonly username: keyof typeof roles;
  readonly role: (typeof roles)[keyof typeof roles];
};

type StoredAccount = {
  username: string;
  role: string;
  scheme: string;
  salt: string;
  hash: string;
};

const format = "CAMACHO_DEV_ACCOUNTS_V1";
const scheme = "scrypt-N32768-r8-p1-v1";
const params = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hexSalt = /^[0-9a-f]{32}$/;
const hexHash = /^[0-9a-f]{128}$/;

function isOperator(username: string): username is keyof typeof roles {
  return Object.prototype.hasOwnProperty.call(roles, username);
}

/**
 * Verify a local operator's password against the already provisioned OS-profile
 * account store. This only proves knowledge of a password: it MUST NOT grant
 * commercial SSA/SAS claims or bind a connection to a BUSINESS session.
 *
 * The caller must implement a bounded, durable attempt policy before exposing
 * this through an IPC/HTTP endpoint. No renderer or Electron main process
 * should read the password store or receive its hashes.
 */
export async function verifyLocalOperatorPassword(
  storePath: string,
  username: string,
  password: string,
): Promise<LocalOperator | null> {
  if (typeof username !== "string" || typeof password !== "string" ||
      password.length < 1 || Buffer.byteLength(password, "utf8") > 512) return null;

  const stat = await lstat(storePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) {
    throw Error("LOCAL_OPERATOR_STORE_INVALID");
  }

  const parsed: unknown = JSON.parse(await readFile(storePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Error("LOCAL_OPERATOR_STORE_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  if (record.format !== format || !Array.isArray(record.accounts) ||
      record.accounts.length !== Object.keys(roles).length) {
    throw Error("LOCAL_OPERATOR_STORE_INVALID");
  }

  const seen = new Set<string>();
  const accounts: StoredAccount[] = [];
  for (const candidate of record.accounts) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw Error("LOCAL_OPERATOR_STORE_INVALID");
    }
    const a = candidate as StoredAccount;
    if (typeof a.username !== "string" || !isOperator(a.username) ||
        seen.has(a.username) || a.role !== roles[a.username] ||
        a.scheme !== scheme || typeof a.salt !== "string" || !hexSalt.test(a.salt) ||
        typeof a.hash !== "string" || !hexHash.test(a.hash)) {
      throw Error("LOCAL_OPERATOR_STORE_INVALID");
    }
    seen.add(a.username);
    accounts.push(a);
  }

  // No implicit identity on a missing user; never trust a caller-supplied role.
  if (!isOperator(username)) return null;
  const entry = accounts.find((a) => a.username === username);
  if (!entry) throw Error("LOCAL_OPERATOR_STORE_INVALID");

  const computed = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, Buffer.from(entry.salt, "hex"), 64, params, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  const correct = timingSafeEqual(computed, Buffer.from(entry.hash, "hex"));
  computed.fill(0);
  return correct ? Object.freeze({ username, role: roles[username] }) : null;
}
