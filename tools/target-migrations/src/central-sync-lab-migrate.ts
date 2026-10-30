/**
 * Explicit isolated-lab migration entry. Never use with an existing POS DB.
 * The operator wrapper uses only loopback port 55436 and a disposable Docker
 * container, and checks those boundaries before invoking this command.
 */
import { applyPostgres001 } from "./postgres.js";

const url = process.env.POSTGRES_ADMIN_URL;
if (!url) throw new Error("LAB_POSTGRES_ADMIN_URL_MISSING");
const parsed = new URL(url);
if (
  parsed.protocol !== "postgres:" ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== "55436" ||
  parsed.pathname !== "/postgres" ||
  parsed.username !== "postgres" ||
  process.env.CAMACHO_ISOLATED_SYNC_LAB !== "YES"
) {
  throw new Error("LAB_POSTGRES_TARGET_NOT_DISPOSABLE");
}
const result = await applyPostgres001({ adminUrl: url });
console.log(JSON.stringify({
  migration: "001_central_foundation",
  executionId: result.executionId,
  noOp: result.noOp,
  reconciled: result.reconciled,
  checksum: result.checksumHex,
}));
