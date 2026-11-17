import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import * as z from "zod";
import { parseServiceConfig } from "../config.js";
import { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../security/insecure-derived-key-provider.js";
import { WindowsDpapiKeyProvider } from "../security/windows-dpapi-key-provider.js";
import type { SecretStoreKeyProvider } from "../security/encrypted-secret-store.js";
import {
  FactusPayCredentialStore,
  factusPayCredentialContext,
  type FactusPayCredentialDeposit,
} from "./factus-pay-credential-store.js";

const MAX_INPUT_BYTES = 64 * 1024;

const DepositInputSchema = z.strictObject({
  environment: z.literal("SANDBOX"),
  email: z.string().min(1).max(256),
  password: z.string().min(1).max(4096),
});

export type DepositInput = z.infer<typeof DepositInputSchema>;

export async function readDepositInput(stream: Readable): Promise<DepositInput> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    total += buffer.byteLength;
    if (total > MAX_INPUT_BYTES) {
      for (const previous of chunks) previous.fill(0);
      throw new Error("deposit input exceeds maximum size");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  for (const buffer of chunks) buffer.fill(0);
  return DepositInputSchema.parse(JSON.parse(raw));
}

export function openFactusPayCredentialStore(
  dataDirectory: string,
  binding: { readonly installationId: string; readonly deviceId: string; readonly companyId: string },
): { store: FactusPayCredentialStore; secrets: EncryptedFileSecretStore } {
  const directory = join(dataDirectory, "security");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyProvider: SecretStoreKeyProvider = process.platform === "win32"
    ? new WindowsDpapiKeyProvider(directory)
    : new InsecureDerivedKeyProvider(directory);
  const secrets = new EncryptedFileSecretStore(
    directory,
    keyProvider,
    factusPayCredentialContext(binding),
  );
  return { store: new FactusPayCredentialStore(secrets, binding.companyId), secrets };
}

export function depositFactusPayCredential(
  store: FactusPayCredentialStore,
  input: DepositInput,
): { readonly version: string } {
  const deposit: FactusPayCredentialDeposit = {
    environment: input.environment,
    email: input.email,
    password: input.password,
  };
  return store.deposit(deposit);
}

export async function runDepositCli(
  environment: NodeJS.ProcessEnv,
  stdin: Readable,
  write: (line: string) => void,
): Promise<number> {
  try {
    if (process.platform !== "win32" && environment.NODE_ENV !== "test") {
      throw new Error("Factus Pay credential deposit requires Windows");
    }
    const config = parseServiceConfig(environment);
    const input = await readDepositInput(stdin);
    const { store, secrets } = openFactusPayCredentialStore(config.data_directory, {
      installationId: config.installation_id,
      deviceId: config.device_id,
      companyId: config.company_id,
    });
    try {
      const reference = depositFactusPayCredential(store, input);
      write(JSON.stringify({ status: "DEPOSITED", version: reference.version }));
      return 0;
    } finally {
      secrets.destroy();
    }
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "DEPOSIT_FAILED";
    write(JSON.stringify({ status: "REJECTED", code }));
    return 1;
  }
}