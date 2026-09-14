import {
  FACTUS_ADAPTER_DECLARATION,
  type CredentialReference,
  type FactusCredential,
  type FactusCredentialResolver,
} from "@pos-platform/fiscal-adapters";
import { FiscalCredentialShapeError, type FiscalCredentialStore } from "./fiscal-credential-store.js";

/**
 * `FactusCredentialResolver` de produccion (`DEC-021` F2).
 *
 * Es la pieza que `DEC-021` §2.3 echaba en falta: hasta ahora el unico
 * resolutor era el fake de las pruebas. Este lee del almacen de `SEC-004` y no
 * de otra parte — en particular **no del entorno**. `FACTUS_SANDBOX_ENV` existe
 * para la ejecucion manual contra el sandbox real en el equipo del propietario
 * (`DEC-021` F6) y no se toca aqui.
 *
 * La unica logica propia es la traduccion de nombres: la declaracion del
 * adapter usa `client_id` y `client_secret` porque asi los entrega FACTUS, y
 * `FactusCredential` usa `clientId` y `clientSecret` porque asi se escribe
 * TypeScript. Traducir en un solo sitio evita que cada llamador invente su
 * propia correspondencia.
 */

const FIELD_TO_PROPERTY = {
  client_id: "clientId",
  client_secret: "clientSecret",
  username: "username",
  password: "password",
} as const satisfies Record<string, keyof FactusCredential>;

export class SecretStoreFactusCredentialResolver implements FactusCredentialResolver {
  constructor(private readonly store: FiscalCredentialStore) {}

  resolve(reference: CredentialReference): Promise<FactusCredential> {
    // Sincrono por dentro y `Promise` por fuera: el puerto lo pide asi porque
    // otro proveedor podria consultar un KMS remoto. Aqui el almacen es local.
    return new Promise<FactusCredential>((resolve) => {
      const fields = this.store.resolve(reference);
      const present: Record<string, string> = {};
      for (const fieldName of Object.keys(FIELD_TO_PROPERTY)) {
        const value = fields[fieldName];
        if (typeof value !== "string" || value.length === 0) {
          // El nombre del campo si aparece —es publico—; el valor jamas.
          throw new FiscalCredentialShapeError(`stored FACTUS credential lacks ${fieldName}`);
        }
        present[fieldName] = value;
      }
      resolve({
        clientId: present.client_id!,
        clientSecret: present.client_secret!,
        username: present.username!,
        password: present.password!,
      });
    });
  }

  /** Requisito declarado por el adapter, para depositar y para redactar. */
  static get requirement() {
    return FACTUS_ADAPTER_DECLARATION.credential;
  }
}
