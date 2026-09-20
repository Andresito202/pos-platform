/**
 * Credencial de dispositivo para la API central.
 *
 * `integration-contracts.md:208` exige «autenticación de dispositivo conforme a
 * `DEC-008`», y `CentralHttpRequestHeadersSchema` declara `authorization` como
 * cabecera obligatoria. Nada de eso está materializado en el runtime: no existe
 * registro del dispositivo contra la autoridad, no existe emisión de credencial
 * y no existe transporte por el que hubieran viajado.
 *
 * Se declara el puerto y la implementación por defecto **se niega**. Es la misma
 * disciplina que `sessionSigningKeys` en `main.ts`: se prefiere la negativa
 * explícita a fabricar una autenticación que nadie ha provisto.
 *
 * **La credencial no llega nunca por variable de entorno.** Un secreto en el
 * entorno del proceso es legible por cualquier diagnóstico, acaba en volcados de
 * memoria y sobrevive en el historial del shell.
 * `secret-key-and-support-management.md:39` prohíbe la clase «Firma operativa»
 * en el cliente, y `security-model.md:155` sitúa los secretos locales en el
 * almacén protegido del sistema, nunca en configuración plana.
 */

export const DEVICE_CREDENTIAL_UNPROVISIONED = "DEVICE_CREDENTIAL_UNPROVISIONED";

export class CentralCredentialUnavailableError extends Error {
  readonly code = DEVICE_CREDENTIAL_UNPROVISIONED;
  constructor(message: string) {
    super(message);
    this.name = "CentralCredentialUnavailableError";
  }
}

export interface DeviceCredentialProvider {
  /**
   * Valor opaco de la cabecera `Authorization`, ya formado.
   *
   * Devolverlo formado —y no un token desnudo— evita que el llamador tenga que
   * conocer el esquema de autenticación, que `DEC-008` todavía no fija.
   */
  authorization(): Promise<string>;
}

/** Implementación por defecto en producción: no hay credencial y no se inventa. */
export class UnprovisionedDeviceCredentialProvider implements DeviceCredentialProvider {
  authorization(): Promise<string> {
    return Promise.reject(
      new CentralCredentialUnavailableError(
        "device credential is not provisioned: DEC-008 device authentication has no runtime materialization",
      ),
    );
  }
}
