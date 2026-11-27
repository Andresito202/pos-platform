import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

/** Verify the required commercial runtime manifest and reject unsafe assets. */
export function verifyAndroidEmbeddedRuntimeIntegrity(
  runtimeRoot: string,
): void {
  const manifestPath = join(runtimeRoot, "files.json");
  if (!existsSync(manifestPath)) {
    throw new Error("ANDROID_RUNTIME_MANIFEST_REQUIRED");
  }
  const root = realpathSync(runtimeRoot);
  const stat = lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_097_152) throw new Error("ANDROID_RUNTIME_MANIFEST_REJECTED");
  let manifest: { files?: Record<string, string> };
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(manifestPath))) as {
      files?: Record<string, string>;
    };
  } catch {
    throw new Error("ANDROID_RUNTIME_MANIFEST_REJECTED");
  }
  if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files) || Object.keys(manifest.files).length === 0) {
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
    if (!lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink() || !realpathSync(absolute).startsWith(root + sep)) throw new Error("ANDROID_RUNTIME_PATH_REJECTED");
    const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (actual !== expected) throw new Error("ANDROID_RUNTIME_ASSET_TAMPERED");
  }
}
