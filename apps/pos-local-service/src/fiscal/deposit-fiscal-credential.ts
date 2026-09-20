import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import * as z from "zod";
import {
  FISCAL_ENVIRONMENTS,
  FISCAL_PROVIDERS,
  type CredentialReference,
  type CredentialRequirement,
} from "@pos-platform/fiscal-adapters";
import { parseServiceConfig } from "../config.js";
import { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../security/insecure-derived-key-provider.js";
import { WindowsDpapiKeyProvider } from "../security/windows-dpapi-key-provider.js";
import type { SecretStoreKeyProvider } from "../security/encrypted-secret-store.js";
import {
  FiscalCredentialStore,
  fiscalCredentialContext,
  type FiscalCredentialDeposit,
} from "./fiscal-credential-store.js";
import { SecretStoreFactusCredentialResolver } from "./factus-credential-resolver.js";

/**
 * Operacion de deposito de credencial fiscal (`DEC-021` F2, segunda mitad).
 *
 * ## Por que es una entrada local y no una operacion del canal
 *
 * Las 18 operaciones comerciales del canal exigen `authenticate()`, que exige
 * una sesion, que exige una SSA verificada, que exige el aprovisionamiento de
 * claves que `G1` dejo abierto. Anadir aqui una decimonovena que **no** pasara
 * por `authenticate()` seria abrir un agujero: depositar la credencial fiscal de
 * un comercio es mas sensible que cobrar una venta, no menos.
 *
 * De modo que el deposito es un acto del operador **en la maquina**, protegido
 * por lo que protege la maquina: la clave del almacen esta ligada al sistema via
 * DPAPI y el fichero queda en `0600`. Cuando `G1` se cierre y exista sesion, esta
 * operacion podra exponerse tambien por el canal sin cambiar el almacen.
 *
 * ## Por que por entrada estandar y no por argumentos ni entorno
 *
 * Un argumento aparece en la lista de procesos del sistema y en el historial del
 * intérprete de comandos. Una variable de entorno aparece en cualquier volcado
 * de diagnostico y la heredan los procesos hijos. La entrada estandar no deja
 * ninguno de los dos rastros, y es ademas lo que permite canalizar el valor
 * desde un gestor de secretos sin que toque el disco.
 *
 * `secret-key-and-support-management.md:39` prohibe la clase «Firma operativa»
 * en el cliente y `security-model.md:155` situa los secretos locales en el
 * almacen protegido del sistema, nunca en configuracion plana.
 */

/** Tope de la entrada. Una credencial son cuatro cadenas cortas. */
const MAX_INPUT_BYTES = 64 * 1024;

const DepositInputSchema = z.strictObject({
  provider: z.enum(FISCAL_PROVIDERS),
  environment: z.enum(FISCAL_ENVIRONMENTS),
  fields: z.record(
    z.string().min(1).max(64),
    z.string().min(1).max(4096),
  ),
});

export type DepositInput = z.infer<typeof DepositInputSchema>;

/**
 * Lee el deposito de un flujo, con tope.
 *
 * El texto crudo se limpia en cuanto se ha parseado: no elimina el valor del
 * heap —una cadena de JavaScript no se puede poner a cero— pero si evita
 * conservar una copia viva mas tiempo del necesario.
 */
export async function readDepositInput(stream: Readable): Promise<DepositInput> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    total += buffer.byteLength;
    if (total > MAX_INPUT_BYTES) {
      for (const previous of chunks) previous.fill(0);
      throw new Error(`fiscal credential input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  try {
    const text = raw.toString("utf8");
    if (text.trim().length === 0) throw new Error("fiscal credential input is empty");
    return DepositInputSchema.parse(JSON.parse(text));
  } catch (error) {
    // El error de `zod` cita rutas, no valores; el de `JSON.parse` puede citar
    // un fragmento del texto. Se sustituye por uno propio para que ningun
    // fragmento de credencial llegue a un log.
    if (error instanceof z.ZodError) throw error;
    throw new Error("fiscal credential input is not valid JSON");
  } finally {
    raw.fill(0);
  }
}

/** Aplica el deposito. Devuelve la referencia opaca. */
export function depositFiscalCredential(
  store: FiscalCredentialStore,
  input: DepositInput,
  requirement: CredentialRequirement,
): CredentialReference {
  const deposit: FiscalCredentialDeposit = {
    provider: input.provider,
    environment: input.environment,
    fields: input.fields,
  };
  return store.deposit(deposit, requirement);
}

/** Abre el almacen fiscal con el mismo criterio de plataforma que `main.ts`. */
export function openFiscalCredentialStore(
  dataDirectory: string,
  binding: { readonly installationId: string; readonly deviceId: string },
): { store: FiscalCredentialStore; secrets: EncryptedFileSecretStore } {
  const directory = join(dataDirectory, "security");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyProvider: SecretStoreKeyProvider = process.platform === "win32"
    ? new WindowsDpapiKeyProvider(directory)
    : new InsecureDerivedKeyProvider(directory);
  const secrets = new EncryptedFileSecretStore(
    directory,
    keyProvider,
    fiscalCredentialContext(binding),
  );
  return { store: new FiscalCredentialStore(secrets), secrets };
}

/**
 * Punto de entrada del operador.
 *
 * Imprime **solo la referencia**: `secretRef` y `version` no son secretos y son
 * lo que el nucleo necesita conocer.
 */
export async function runDepositCli(
  environment: NodeJS.ProcessEnv,
  stdin: Readable,
  write: (line: string) => void,
): Promise<number> {
  try {
    // Mismo guardia que `main.ts`, y por el mismo motivo: fuera de Windows el
    // proveedor de clave es el derivado de pruebas, que protege menos. Confiar
    // en que ese proveedor se niegue por su cuenta dejaria la exigencia de
    // plataforma implicita en una operacion que **escribe un secreto**.
    if (process.platform !== "win32" && environment.NODE_ENV !== "test") {
      throw new Error("fiscal credential deposit requires Windows");
    }
    const config = parseServiceConfig(environment);
    const input = await readDepositInput(stdin);
    if (input.provider !== "FACTUS") {
      // Solo FACTUS declara hoy su requisito de credencial de forma verificada.
      write(JSON.stringify({ status: "REJECTED", code: "PROVIDER_NOT_SUPPORTED" }));
      return 1;
    }
    const { store, secrets } = openFiscalCredentialStore(config.data_directory, {
      installationId: config.installation_id,
      deviceId: config.device_id,
    });
    try {
      const reference = depositFiscalCredential(
        store,
        input,
        SecretStoreFactusCredentialResolver.requirement,
      );
      write(JSON.stringify({ status: "DEPOSITED", reference }));
      return 0;
    } finally {
      secrets.destroy();
    }
  } catch (error) {
    // Nunca el mensaje crudo del fallo: puede venir de un parseo que cite texto.
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "DEPOSIT_FAILED";
    write(JSON.stringify({ status: "REJECTED", code }));
    return 1;
  }
}
