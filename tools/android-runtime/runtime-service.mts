import { AndroidCommercialHost } from "../../apps/pos-local-service/src/android/android-commercial-host.js";
import { AndroidCommercialServiceControl } from "../../apps/pos-local-service/src/android/android-commercial-service-control.js";
import { verifyAndroidEmbeddedRuntimeIntegrity } from "../../apps/pos-local-service/src/android/android-runtime-integrity.js";
import { AndroidKeystoreKeyProvider } from "../../apps/pos-local-service/src/security/android-keystore-key-provider.js";
import { EncryptedFileSecretStore } from "../../apps/pos-local-service/src/security/encrypted-secret-store.js";
import { fstatSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = dirname(fileURLToPath(import.meta.url));
verifyAndroidEmbeddedRuntimeIntegrity(runtimeRoot);
process.env.ANDROID_EMBEDDED_RUNTIME_ROOT = runtimeRoot;

if (process.platform !== "android") throw new Error("ANDROID_HOST_REQUIRED");
const directory = process.env.CAMACHO_ANDROID_SERVICE_DIRECTORY;
if (
  !directory
  || (
    !directory.startsWith("/data/user/0/co.camachopos.colombia/files/")
    && !directory.startsWith("/data/data/co.camachopos.colombia/files/")
  )
) {
  throw new Error("ANDROID_PRIVATE_SERVICE_DIRECTORY_REQUIRED");
}
if (!directory.endsWith("/android-local-service")) throw new Error("ANDROID_SERVICE_DIRECTORY_REJECTED");

const descriptor = fstatSync(0);
if (!descriptor.isFIFO() && !descriptor.isSocket()) throw new Error("INHERITED_NATIVE_PARENT_PIPE_REQUIRED");

const nativeRoot = Buffer.alloc(32);
let keyProvider: AndroidKeystoreKeyProvider;
try {
  let offset = 0;
  while (offset < 32) {
    const count = readSync(0, nativeRoot, offset, 32 - offset, null);
    if (count === 0) throw new Error("NATIVE_CUSTODY_ROOT_TRUNCATED");
    offset += count;
  }
  keyProvider = new AndroidKeystoreKeyProvider(nativeRoot);
} finally {
  nativeRoot.fill(0);
}

const seal = new EncryptedFileSecretStore(
  join(dirname(directory), "security"),
  keyProvider,
  "android.foundation.seal-check.v1",
);
const custodyProtection = seal.protection;
const sealRestored = seal.has("android-foundation-check");
const sealValue = Buffer.from("camacho-android-custody-check-v1");
try {
  if (sealRestored) {
    const opened = seal.read("android-foundation-check");
    try {
      if (!opened.equals(sealValue)) throw new Error("ANDROID_CUSTODY_SEAL_REJECTED");
    } finally {
      opened.fill(0);
    }
  } else {
    seal.write("android-foundation-check", sealValue);
  }
} finally {
  sealValue.fill(0);
  seal.destroy();
}

const host = new AndroidCommercialHost(directory, keyProvider);
let stopping: Promise<void> | undefined;

function report(): void {
  process.stdout.write(
    JSON.stringify({
      ...host.status(),
      process_id: process.pid,
      key_protection: custodyProtection,
      sealed_store_restored: sealRestored,
    }) + "\n",
  );
}

function stop(code: number): Promise<void> {
  stopping ??= (async () => {
    try {
      await host.stop();
      report();
    } finally {
      keyProvider.destroy();
      process.exitCode = code;
      process.stdin.destroy();
    }
  })();
  return stopping;
}

try {
  await host.start();
  report();
} catch (error) {
  keyProvider.destroy();
  throw error;
}

const control = new AndroidCommercialServiceControl(
  () => host.licenseInformation(),
  (value) => host.handleRequest(value),
  (value) => process.stdout.write(JSON.stringify(value) + "\n"),
  (code) => {
    void stop(code);
  },
);
process.stdin.on("data", (chunk: Buffer) => {
  if (!stopping) control.accept(chunk);
});
process.stdin.on("end", () => {
  if (!stopping) control.end();
});
process.on("SIGTERM", () => {
  void stop(0);
});
process.on("SIGINT", () => {
  void stop(0);
});
