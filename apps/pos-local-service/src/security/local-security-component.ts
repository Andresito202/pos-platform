import { mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { RuntimeComponent } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import { DeviceIdentity } from "./device-identity.js";
import {
  EncryptedFileSecretStore,
  type SecretStoreKeyProvider,
  type SecretStoreProtection,
} from "./encrypted-secret-store.js";
import { LocalSecurityLifecycle } from "./security-lifecycle.js";
import { TrustedClockGuard } from "./trusted-clock.js";

/** Nombre del secreto bajo el que vive la clave privada del dispositivo. */
export const DEVICE_IDENTITY_SECRET = "device-identity";

export interface LocalSecurityBinding {
  readonly installationId: string;
  readonly deviceId: string;
}

/**
 * Contexto criptográfico del almacén de secretos.
 *
 * Entra como AAD del AES-256-GCM y como entropía del DPAPI. Ligarlo a la
 * instalación y al dispositivo significa que un fichero de secreto copiado a
 * otra instalación no se descifra: la autenticación del sobre falla antes de
 * producir un solo byte de texto claro.
 */
export function deviceIdentityContext(binding: LocalSecurityBinding): string {
  return `pos-local-service.device-identity.v1:${binding.installationId}:${binding.deviceId}`;
}

/**
 * `local-security` — materializa la identidad del dispositivo en el arranque
 * (`DEC-020`).
 *
 * Corre inmediatamente después de la base de datos y antes que cualquier otro
 * componente. Si falla, `ServiceLifecycle` marca `FAILED` y el proceso sale con
 * código 1: un equipo que no puede proteger su identidad no atiende una venta.
 *
 * Lo que **no** hace, y conviene que se lea aquí y no sólo en el ADR: no
 * verifica licencia y no adquiere Authorization Snapshot. Ambas exigen una
 * autoridad central que hoy no existe, y cablearlas contra un mapa de claves
 * vacío o un proveedor en memoria sería fabricar confianza.
 */
export class LocalSecurityComponent implements RuntimeComponent {
  readonly name = "local-security";

  private storeValue: EncryptedFileSecretStore | undefined;
  private identityValue: DeviceIdentity | undefined;
  private deviceKeyIdValue: string | undefined;
  private lifecycleValue: LocalSecurityLifecycle | undefined;

  constructor(
    private readonly databaseComponent: LocalDatabaseComponent,
    private readonly binding: LocalSecurityBinding,
    private readonly keyProvider: SecretStoreKeyProvider,
    private readonly secretsDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!isAbsolute(secretsDirectory)) throw new Error("secrets directory must be absolute");
  }

  /** `OS_BOUND` o `TEST_ONLY`. El arranque lo escribe en el log. */
  get protection(): SecretStoreProtection {
    return this.keyProvider.protection;
  }

  /** Huella pública de la clave del dispositivo. No es un secreto. */
  get deviceKeyId(): string {
    if (!this.deviceKeyIdValue) throw new Error("device identity is not ready");
    return this.deviceKeyIdValue;
  }

  /**
   * La identidad, para quien deba firmar un desafío. La clave privada no sale
   * de aquí: `DeviceIdentity` sólo expone la pública y la firma.
   */
  get identity(): DeviceIdentity {
    if (!this.identityValue) throw new Error("device identity is not ready");
    return this.identityValue;
  }

  /** El libro de identidad y licencia, para consumidores posteriores. */
  get lifecycle(): LocalSecurityLifecycle {
    if (!this.lifecycleValue) throw new Error("security lifecycle is not ready");
    return this.lifecycleValue;
  }

  /**
   * El almacén vivo de `SEC-004`. Es el prerequisito directo del resolvedor de
   * credenciales de FACTUS en producción: ahí es donde ese secreto debe vivir,
   * y no en una variable de entorno.
   */
  get secretStore(): EncryptedFileSecretStore {
    if (!this.storeValue) throw new Error("secret store is not ready");
    return this.storeValue;
  }

  async start(): Promise<void> {
    const database = this.databaseComponent.database;

    // 1. El reloj, antes que nada: todo lo que sigue lleva marca de tiempo, y
    //    revivir una licencia vencida empieza siempre por mover el reloj atrás.
    new TrustedClockGuard(database).accept(this.now());

    // 2. El almacén. `mode` es efectivo en POSIX; en Windows la ACL del fichero
    //    de clave la fija el propio DPAPI provider.
    mkdirSync(this.secretsDirectory, { recursive: true, mode: 0o700 });
    const store = new EncryptedFileSecretStore(
      this.secretsDirectory,
      this.keyProvider,
      deviceIdentityContext(this.binding),
    );
    this.storeValue = store;

    // 3. La identidad: se carga si el secreto ya existe, se crea la primera vez.
    //
    //    Si el secreto existe y no se descifra, el sobre no autentica: o la
    //    clave raiz cambio —otro perfil de Windows, otra instalacion— o el
    //    fichero fue manipulado. Ninguna de las dos se arregla generando una
    //    identidad nueva encima, asi que se detiene el arranque diciendo cual
    //    es la situacion en vez de dejar salir «authentication failed» a secas.
    let identity: DeviceIdentity;
    if (store.has(DEVICE_IDENTITY_SECRET)) {
      try {
        identity = DeviceIdentity.load(store, DEVICE_IDENTITY_SECRET);
      } catch (cause) {
        throw new Error(
          "device identity secret could not be opened: the protected envelope does not authenticate "
          + "under this installation's root key. The secret belongs to another installation, another "
          + "Windows profile, or it was tampered with.",
          { cause },
        );
      }
    } else {
      identity = DeviceIdentity.create(store, DEVICE_IDENTITY_SECRET);
    }
    const deviceKeyId = identity.deviceKeyId();

    // 4. El registro en el libro, con su asiento de auditoría. Idempotente
    //    cuando coincide; detiene el arranque cuando no.
    const lifecycle = new LocalSecurityLifecycle(database, this.now);
    try {
      lifecycle.registerInitialDeviceKey(deviceKeyId, DEVICE_IDENTITY_SECRET);
    } catch (cause) {
      throw new Error(
        "device identity registration refused: the protected secret does not match the device key "
        + "recorded for this installation. Replacing a device key is an explicit operation with a "
        + "written reason, never an automatic effect of a restart.",
        { cause },
      );
    }

    this.identityValue = identity;
    this.deviceKeyIdValue = deviceKeyId;
    this.lifecycleValue = lifecycle;
  }

  async stop(): Promise<void> {
    // Cero la clave raíz en memoria. La identidad queda en disco, cifrada.
    this.storeValue?.destroy();
    this.storeValue = undefined;
    this.identityValue = undefined;
    this.deviceKeyIdValue = undefined;
    this.lifecycleValue = undefined;
  }
}
