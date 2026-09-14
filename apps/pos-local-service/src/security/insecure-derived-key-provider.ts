import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { SecretStoreKeyProvider } from "./encrypted-secret-store.js";

/**
 * Separador de dominio entre los tres campos derivados. Sin él, `directory` y
 * `context` se concatenarían y dos pares distintos podrían producir la misma
 * clave.
 */
const SEPARATOR = Buffer.from([0x00]);

/**
 * Proveedor de clave raíz **sin protección del sistema operativo**.
 *
 * Existe por una sola razón: `main.ts` sólo permite ejecución productiva en
 * Windows, y en Windows el proveedor es siempre `WindowsDpapiKeyProvider`. Pero
 * el arranque completo —`src/main.ts` como proceso real— se verifica también en
 * POSIX, y allí DPAPI no existe. Sin este proveedor habría que elegir entre no
 * verificar el arranque fuera de Windows o inventar una rama que apague la
 * seguridad; ninguna de las dos es aceptable.
 *
 * La clave se **deriva**, no se genera: el mismo directorio y el mismo contexto
 * producen los mismos 32 bytes. Así la identidad del dispositivo sobrevive al
 * reinicio también bajo pruebas, que es justamente el comportamiento que hay
 * que poder verificar.
 *
 * No es un secreto. Cualquiera que lea este fichero puede reproducir la clave.
 * Por eso declara `TEST_ONLY`, por eso el arranque escribe ese valor en el log,
 * y por eso se llama «insecure»: un `grep` por esa palabra debe encontrarlo.
 *
 * Se guarda dos veces, en construcción y en cada entrega de clave. No confía en
 * que el llamador haya comprobado nada.
 */
export class InsecureDerivedKeyProvider implements SecretStoreKeyProvider {
  readonly protection = "TEST_ONLY" as const;

  constructor(
    private readonly directory: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    if (!isAbsolute(directory)) throw new Error("derived key directory must be absolute");
    this.assertTestEnvironment();
  }

  loadKey(context: string): Buffer {
    this.assertTestEnvironment();
    if (!context) throw new Error("derived key context is required");
    return createHash("sha256")
      .update("pos-platform.insecure-derived-root-key.v1")
      .update(SEPARATOR)
      .update(this.directory)
      .update(SEPARATOR)
      .update(context)
      .digest();
  }

  private assertTestEnvironment(): void {
    if (this.environment["NODE_ENV"] !== "test") {
      throw new Error("insecure derived key provider is refused outside NODE_ENV=test");
    }
  }
}
