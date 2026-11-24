import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAndroidEmbeddedRuntimeIntegrity } from "../src/android/android-runtime-integrity.js";

describe("verifyAndroidEmbeddedRuntimeIntegrity", () => {
  it("accepts matching digests and rejects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "android-runtime-"));
    try {
      await mkdir(join(root, "bin"), { recursive: true });
      const payload = Buffer.from("camacho-runtime-probe");
      await writeFile(join(root, "bin", "node"), payload);
      const digest = createHash("sha256").update(payload).digest("hex");
      await writeFile(
        join(root, "files.json"),
        JSON.stringify({ bundle_id: "x", files: { "bin/node": digest } }),
      );
      expect(() => verifyAndroidEmbeddedRuntimeIntegrity(root)).not.toThrow();

      await writeFile(join(root, "bin", "node"), Buffer.from("tampered"));
      expect(() => verifyAndroidEmbeddedRuntimeIntegrity(root)).toThrow(
        /ANDROID_RUNTIME_ASSET_TAMPERED/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects path traversal entries in the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "android-runtime-"));
    try {
      await writeFile(
        join(root, "files.json"),
        JSON.stringify({ files: { "../etc/passwd": "a".repeat(64) } }),
      );
      expect(() => verifyAndroidEmbeddedRuntimeIntegrity(root)).toThrow(
        /ANDROID_RUNTIME_PATH_REJECTED/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
