import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  EncryptedFileSecretStore,
  WindowsDpapiKeyProvider,
} from "../security/index.js";

const LOCAL_CHANNEL_SECRET_NAME = "local-channel-auth";

export function loadOrCreateWindowsLocalChannelSecret(
  dataDirectory: string,
  installationId: string,
  platform: NodeJS.Platform = process.platform,
): Buffer {
  if (platform !== "win32") {
    throw new Error("local channel production secret requires Windows DPAPI");
  }

  const securityDirectory = join(dataDirectory, "security");
  const dpapiDirectory = join(securityDirectory, "dpapi");
  mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });

  const store = new EncryptedFileSecretStore(
    securityDirectory,
    new WindowsDpapiKeyProvider(dpapiDirectory, platform),
    `local-channel:${installationId}`,
  );

  try {
    if (store.protection !== "OS_BOUND") {
      throw new Error("local channel secret store must be OS-bound");
    }

    if (store.has(LOCAL_CHANNEL_SECRET_NAME)) {
      const existing = store.read(LOCAL_CHANNEL_SECRET_NAME);
      if (existing.byteLength !== 32) {
        existing.fill(0);
        throw new Error("persisted local channel secret has invalid length");
      }
      return existing;
    }

    const created = randomBytes(32);
    try {
      store.write(LOCAL_CHANNEL_SECRET_NAME, created);
      return Buffer.from(created);
    } finally {
      created.fill(0);
    }
  } finally {
    store.destroy();
  }
}
