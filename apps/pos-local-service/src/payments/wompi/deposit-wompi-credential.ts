import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import * as z from "zod";
import { parseServiceConfig } from "../../config.js";
import { EncryptedFileSecretStore } from "../../security/encrypted-secret-store.js";
import { InsecureDerivedKeyProvider } from "../../security/insecure-derived-key-provider.js";
import { WindowsDpapiKeyProvider } from "../../security/windows-dpapi-key-provider.js";
import type { SecretStoreKeyProvider } from "../../security/encrypted-secret-store.js";
import {
  WOMPI_CREDENTIAL_SECRET,
  WompiCredentialSchema,
  wompiCredentialContext,
  type WompiCredentialBinding,
} from "./wompi-credential.js";

/**
 * Depósito de la credencial de Wompi en el almacén protegido del equipo.
 *
 * ## Por qué existe
 *
 * `resolveWompiPaymentProvider` sabía **leer** el sobre desde el 2026-09-20 y
 * nada sabía escribirlo: no había una sola ruta soportada para aprovisionar un
 * equipo, de modo que el adapter de Wompi estaba completo y era inalcanzable.
 * El lado fiscal ya tenía su depósito (`DEC-021` F2) y éste no inventa un
 * segundo mecanismo: mismo almacén, misma disciplina, misma forma de entrada.
 *
 * ## Por qué es una entrada local y no una operación del canal
 *
 * Las operaciones comerciales exigen `authenticate()`, que exige una sesión.
 * Añadir aquí una que **no** pasara por ahí sería abrir un agujero: depositar
 * la credencial de cobro de un comercio es más sensible que cobrar una venta,
 * no menos. El depósito es un acto del operador **en la máquina**, protegido
 * por lo que protege la máquina.
 *
 * ## Por qué por entrada estándar y no por argumentos ni entorno
 *
 * Un argumento aparece en la lista de procesos y en el historial del
 * intérprete. Una variable de entorno aparece en cualquier volcado de
 * diagnóstico y la heredan los procesos hijos. La entrada estándar no deja
 * ninguno de los dos rastros, y permite canalizar el valor desde un gestor de
 * secretos sin que toque el disco.
 *
 * `WOMPI_SANDBOX_ENV` nombra las variables **para que un operador sepa cómo
 * llamar a lo que va a aprovisionar**; este módulo no las lee, igual que el
 * runtime tampoco.
 */

/** Tope de la entrada. Una credencial son tres o cuatro cadenas cortas. */
const MAX_INPUT_BYTES = 64 * 1024;

export type WompiDepositInput = z.infer<typeof WompiCredentialSchema>;

/**
 * Lee el depósito de un flujo, con tope.
 *
 * El texto crudo se limpia en cuanto se ha parseado: no borra el valor del
 * heap —una cadena de JavaScript no se puede poner a cero— pero evita
 * conservar una copia viva más tiempo del necesario. Es la misma disciplina de
 * `readDepositInput` en el lado fiscal, y por el mismo motivo.
 */
export async function readWompiDepositInput(stream: Readable): Promise<WompiDepositInput> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    total += buffer.byteLength;
    if (total > MAX_INPUT_BYTES) {
      for (const previous of chunks) previous.fill(0);
      throw new Error(`wompi credential input exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  try {
    const text = raw.toString("utf8");
    if (text.trim().length === 0) throw new Error("wompi credential input is empty");
    return WompiCredentialSchema.parse(JSON.parse(text));
  } catch (error) {
    // El error de `zod` cita rutas, no valores; el de `JSON.parse` puede citar
    // un fragmento del texto. Se sustituye por uno propio para que ningún
    // fragmento de credencial llegue a un log.
    if (error instanceof z.ZodError) throw error;
    throw new Error("wompi credential input is not valid JSON");
  } finally {
    raw.fill(0);
  }
}

/** Abre el almacén con el mismo criterio de plataforma que `main.ts`. */
export function openWompiCredentialStore(
  dataDirectory: string,
  binding: WompiCredentialBinding,
): EncryptedFileSecretStore {
  const directory = join(dataDirectory, "security");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyProvider: SecretStoreKeyProvider = process.platform === "win32"
    ? new WindowsDpapiKeyProvider(directory)
    : new InsecureDerivedKeyProvider(directory);
  return new EncryptedFileSecretStore(directory, keyProvider, wompiCredentialContext(binding));
}

/**
 * Punto de entrada del operador.
 *
 * **No imprime ninguna referencia y menos aún un valor.** El lado fiscal
 * devuelve un `secretRef` porque el núcleo lo necesita para resolver la
 * credencial; aquí no hay tal cosa: el sobre es único por equipo y el runtime
 * lo encuentra por su nombre. Lo único que el operador necesita saber es si
 * quedó escrito.
 */
export async function runWompiDepositCli(
  environment: NodeJS.ProcessEnv,
  stdin: Readable,
  write: (line: string) => void,
): Promise<number> {
  try {
    // Mismo guardia que `main.ts` y que el depósito fiscal, y por el mismo
    // motivo: fuera de Windows el proveedor de clave es el derivado de
    // pruebas, que protege menos. Confiar en que ese proveedor se niegue por
    // su cuenta dejaría la exigencia de plataforma implícita en una operación
    // que **escribe un secreto**.
    if (process.platform !== "win32" && environment.NODE_ENV !== "test") {
      throw new Error("wompi credential deposit requires Windows");
    }
    const config = parseServiceConfig(environment);
    const credential = await readWompiDepositInput(stdin);

    const store = openWompiCredentialStore(config.data_directory, {
      installationId: config.installation_id,
      deviceId: config.device_id,
    });
    try {
      store.write(WOMPI_CREDENTIAL_SECRET, Buffer.from(JSON.stringify(credential), "utf8"));
      write(JSON.stringify({ status: "DEPOSITED", secret: WOMPI_CREDENTIAL_SECRET }));
      return 0;
    } finally {
      store.destroy();
    }
  } catch (error) {
    // Nunca el mensaje crudo del fallo: puede venir de un parseo que cite
    // texto. `INVALID_CREDENTIAL` distingue «lo que me diste no sirve» de un
    // fallo de escritura, sin decir qué traía.
    const code = error instanceof z.ZodError
      ? "INVALID_CREDENTIAL"
      : error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "DEPOSIT_FAILED";
    write(JSON.stringify({ status: "REJECTED", code }));
    return 1;
  }
}
