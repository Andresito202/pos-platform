import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Verifies embedded Node/SQLite runtime assets against files.json digests.
 * Fail-closed when the manifest is present but tampered. Absence of files.json
 * keeps unpackaged lab layouts usable.
 */
export function verifyAndroidEmbeddedRuntimeIntegrity(runtimeRoot: string): void {
  const manifestPath = join(runtimeRoot, "files.json");
  if (!existsSync(manifestPath)) return;
  let manifest: { files?: Record<string, string> };
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(manifestPath))) as {
      files?: Record<string, string>;
    };
  } catch {
    throw new Error("ANDROID_RUNTIME_MANIFEST_REJECTED");
  }
  if (!manifest.files || typeof manifest.files !== "object") {
    throw new Error("ANDROID_RUNTIME_MANIFEST_REJECTED");
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (relative === "files.json") continue;
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error("ANDROID_RUNTIME_DIGEST_REJECTED");
    }
    if (relative.includes("\0") || relative.includes("..") || relative.startsWith("/") || relative.includes("\\")) {
      throw new Error("ANDROID_RUNTIME_PATH_REJECTED");
    }
    const absolute = join(runtimeRoot, relative);
    if (!existsSync(absolute)) throw new Error("ANDROID_RUNTIME_ASSET_MISSING");
    const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (actual !== expected) throw new Error("ANDROID_RUNTIME_ASSET_TAMPERED");
  }
}
