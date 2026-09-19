import { existsSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";
import {
  EncryptedFileSecretStore,
  type SecretStoreKeyProvider,
} from "../../security/index.js";
import { WompiPaymentProvider } from "./wompi-payment-provider.js";

/**
 * Nombre del secreto bajo el que vive la credencial de Wompi.
 *
 * Vive en el mismo almacén cifrado que la identidad del dispositivo
 * (`EncryptedFileSecretStore`, AES-256-GCM sobre fichero `0600`, clave raíz de
 * DPAPI en Windows). No es un mecanismo nuevo: `local-security-component.ts` ya
 * dejó escrito que ese almacén «es el prerequisito directo del resolvedor de
 * credenciales de FACTUS en producción: ahí es donde ese secreto debe vivir, y
 * no en una variable de entorno». Wompi toma la misma vía.
 *
 * Lo que eso descarta, deliberadamente: no va en `parseServiceConfig` —su lista
 * de claves `POS_*` es estricta y un `POS_WOMPI_INTEGRITY_SECRET` pondría el
 * secreto en el entorno del proceso, visible para cualquiera que lea la línea
 * de comandos del servicio—, no va en SQLite, y no cruza jamás hacia el
 * Desktop: el canal IPC no expone ninguna operación que lo devuelva.
 */
export const WOMPI_CREDENTIAL_SECRET = "payments-wompi";

export interface WompiCredentialBinding {
  readonly installationId: string;
  readonly deviceId: string;
}

/**
 * Contexto criptográfico del sobre, con la misma forma que
 * `deviceIdentityContext`: entra como AAD del AES-256-GCM y como entropía de
 * DPAPI, de modo que un fichero copiado a otra instalación o a otro equipo no
 * descifra. La autenticación del sobre falla antes de producir un solo byte.
 */
export function wompiCredentialContext(binding: WompiCredentialBinding): string {
  return `pos-local-service.payments-wompi.v1:${binding.installationId}:${binding.deviceId}`;
}

/**
 * Los tres valores que Wompi entrega al comercio.
 *
 * **Este tipo no se serializa nunca.** No tiene `toJSON`, no se escribe en
 * logs, no viaja en errores, no se audita y no se guarda fuera del sobre
 * cifrado. Existe sólo entre leer el secreto y construir el adapter — la misma
 * regla que `FactusCredential` ya declara para su lado fiscal.
 *
 * `publicKey` es pública por diseño —viaja en la URL de checkout y autentica
 * `GET /v1/transactions/{id}`—; aun así vive dentro del mismo sobre, porque
 * separarla obligaría a un segundo mecanismo para nada.
 */
export interface WompiCredential {
  readonly publicKey: string;
  readonly integritySecret: string;
  readonly eventsSecret: string;
  readonly redirectUrl?: string;
}

const WompiCredentialSchema = z.strictObject({
  publicKey: z.string().min(1),
  integritySecret: z.string().min(1),
  eventsSecret: z.string().min(1),
  redirectUrl: z.string().url().optional(),
});

/**
 * Nombres de variable de entorno para una ejecución local contra el sandbox de
 * Wompi. **Los nombres son públicos; los valores no.** Ninguno se lee en CI ni
 * en el runtime: existen para que un operador sepa cómo llamar a lo que va a
 * aprovisionar, no para que el servicio los consulte.
 */
export const WOMPI_SANDBOX_ENV = {
  publicKey: "WOMPI_SANDBOX_PUBLIC_KEY",
  integritySecret: "WOMPI_SANDBOX_INTEGRITY_SECRET",
  eventsSecret: "WOMPI_SANDBOX_EVENTS_SECRET",
} as const;

/** Lo mínimo del almacén que hace falta para leer una credencial. */
export interface WompiCredentialReader {
  has(name: string): boolean;
  read(name: string): Buffer;
}

export class WompiCredentialInvalidError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(
      "the stored Wompi credential is not usable: "
      + `${fields.join(", ")}. The envelope decrypted, so this is a provisioning defect, `
      + "not a key problem. No value is reported.",
    );
    this.name = "WompiCredentialInvalidError";
  }
}

/**
 * Lee la credencial del almacén, o `undefined` si nadie la aprovisionó.
 *
 * La distinción es el contrato entero de este módulo:
 *
 * - **Ausente** → `undefined`. No hay proveedor, y eso es un estado legítimo:
 *   un POS que sólo cobra en efectivo y por transferencia nunca necesitó uno.
 * - **Presente pero inservible** → lanza. Alguien aprovisionó algo y está mal,
 *   y fingir que no hay proveedor escondería su error hasta el primer cobro.
 *
 * El error nombra **qué campos** fallan, nunca qué valor traían. Por eso no se
 * propaga el error de Zod: sus mensajes pueden arrastrar el contenido recibido,
 * y un mensaje de validación no es sitio para un `integrity secret`.
 */
export function readWompiCredential(store: WompiCredentialReader): WompiCredential | undefined {
  if (!store.has(WOMPI_CREDENTIAL_SECRET)) return undefined;

  const plaintext = store.read(WOMPI_CREDENTIAL_SECRET);
  let document: unknown;
  try {
    document = JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    throw new WompiCredentialInvalidError(["the envelope does not contain JSON"]);
  } finally {
    plaintext.fill(0);
  }

  const parsed = WompiCredentialSchema.safeParse(document);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "(root)"))
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort();
    throw new WompiCredentialInvalidError(fields);
  }

  // Se reconstruye en vez de devolver `parsed.data` porque
  // `exactOptionalPropertyTypes` distingue «ausente» de «presente y
  // `undefined`», y `.optional()` de Zod produce lo segundo.
  const { publicKey, integritySecret, eventsSecret, redirectUrl } = parsed.data;
  return {
    publicKey,
    integritySecret,
    eventsSecret,
    ...(redirectUrl === undefined ? {} : { redirectUrl }),
  };
}

/**
 * Construye el proveedor de pagos si —y sólo si— hay una credencial
 * aprovisionada.
 *
 * Abre su propio `EncryptedFileSecretStore` con su propio contexto, igual que
 * hace `loadOrCreateWindowsLocalChannelSecret` para el secreto del canal: el
 * proveedor de clave raíz indexa por contexto, así que dos consumidores
 * distintos no comparten clave aunque compartan directorio.
 *
 * **No hay fallback.** Sin credencial devuelve `undefined` y el servicio
 * arranca sin cobro QR y con el barrido en `disabled`; con una credencial rota
 * lanza y `ServiceLifecycle` deja el arranque en `FAILED`. Lo que no ocurre en
 * ningún caso es que aparezca un proveedor falso: un POS que aparenta poder
 * cobrar y no puede es peor que uno que lo dice.
 */
export function resolveWompiPaymentProvider(input: {
  readonly securityDirectory: string;
  readonly keyProvider: SecretStoreKeyProvider;
  readonly binding: WompiCredentialBinding;
}): WompiPaymentProvider | undefined {
  // Se mira si hay algo que abrir **antes** de abrir nada. Construir el
  // almacén pide la clave raíz, y en Windows pedirla lanza PowerShell y
  // materializa un fichero DPAPI: un coste y un artefacto en cada arranque de
  // cada equipo que no cobra por QR, para leer un secreto que no existe.
  // `store.has` sigue siendo la comprobación real —incluida la negativa ante
  // un enlace simbólico—; esto sólo evita el trabajo cuando no hay fichero.
  if (!existsSync(join(input.securityDirectory, `${WOMPI_CREDENTIAL_SECRET}.secret`))) {
    return undefined;
  }

  const store = new EncryptedFileSecretStore(
    input.securityDirectory,
    input.keyProvider,
    wompiCredentialContext(input.binding),
  );

  try {
    const credential = readWompiCredential(store);
    if (credential === undefined) return undefined;

    return new WompiPaymentProvider({
      checkout: {
        publicKey: credential.publicKey,
        integritySecret: credential.integritySecret,
        ...(credential.redirectUrl === undefined ? {} : { redirectUrl: credential.redirectUrl }),
      },
      events: { eventsSecret: credential.eventsSecret },
    });
  } finally {
    store.destroy();
  }
}
