import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const MANIFEST_VERSION = 1;
export const RUNNER_VERSION = "target-migration-runner/1";
export const POSTGRES_MIGRATION_ID = "001_central_foundation";
export const POSTGRES_002_MIGRATION_ID = "002_external_integrations_foundation";
export const POSTGRES_MIGRATION_LOCK_RESOURCE = "pos-platform:target-migrations:global:v1";
export const SQLITE_MIGRATION_ID = "001_local_migration_control";

export class MigrationInvariantError extends Error {}
export class SimulatedCrashError extends Error {}

export function artifactUrl(relativePath: string): URL {
  return new URL(`../sql/${relativePath}`, import.meta.url);
}

export async function readArtifact(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(artifactUrl(relativePath)), "utf8");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}
