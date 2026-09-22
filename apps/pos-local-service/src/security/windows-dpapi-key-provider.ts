import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { runDpapiRootKey } from "@pos-platform/local-channel";
import type { SecretStoreKeyProvider } from "./encrypted-secret-store.js";

export class WindowsDpapiKeyProvider implements SecretStoreKeyProvider {
  readonly protection = "OS_BOUND" as const;

  constructor(
    private readonly directory: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    if (!isAbsolute(directory)) throw new Error("DPAPI key directory must be absolute");
  }

  loadKey(context: string): Buffer {
    if (this.platform !== "win32") {
      throw new Error("Windows DPAPI key provider requires Windows");
    }
    if (!context) throw new Error("DPAPI key context is required");

    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const contextHash = createHash("sha256").update(context).digest("hex");
    const path = join(this.directory, `root-key-${contextHash}.dpapi`);
    // El script y su invocacion viven en `@pos-platform/local-channel`, que es
    // quien los necesita sin poder importar de aqui. Habia una copia en cada
    // sitio, identicas en significado y distintas en formato, y nada las
    // comparaba: arreglar una no habria alcanzado a la otra.
    return runDpapiRootKey(path, context);
  }
}
