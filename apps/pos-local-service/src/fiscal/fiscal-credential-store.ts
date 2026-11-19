import { randomUUID } from "node:crypto";
import {
  CredentialReferenceSchema,
  secretFieldNames,
  type CredentialReference,
  type CredentialRequirement,
  type FiscalEnvironment,
  type FiscalProvider,
} from "@pos-platform/fiscal-adapters";
import type { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";

/**
 * Custodia local de credenciales fiscales (`DEC-021` F2, sobre `SEC-004`).
 *
 * `DEC-021` §2.3 dejó escrito el hueco entero: existía el almacén cifrado y
 * existía el puerto `FactusCredentialResolver`, y no existía **ni un resolutor
 * de produccion que leyera del almacen, ni una operacion por la que un operador
 * depositara la credencial ahi**. Sin la segunda, la primera es una isla mas.
 *
 * ## Lo que este modulo garantiza, y como
 *
 * **El valor no sale de aqui.** `resolve` devuelve los campos al llamador
 * —que es el adapter, y solo el adapter— y ninguna otra operacion los expone.
 * `reference` y `deposit` devuelven la referencia opaca: eso es lo unico que el
 * nucleo llega a ver, conforme a `credential.ts` §Referencia opaca.
 *
 * **No hay tabla ni fichero de indice.** El nombre del secreto se deriva de
 * `(proveedor, ambiente)`, de modo que localizarlo no exige persistir la
 * referencia en ninguna parte. Una tabla mas seria una copia mas del dato que
 * apunta al secreto, y no aporta nada que la derivacion no de gratis.
 *
 * **Los ambientes no se mezclan.** El nombre los separa, igual que
 * `device-licensing-schema.md:268` exige para las claves de firma: produccion y
 * sandbox nunca comparten registro.
 *
 * **Una referencia caduca falla cerrada.** La version viaja dentro del sobre
 * cifrado y `resolve` la compara. Tras una rotacion, quien conserve la
 * referencia anterior recibe un error, no la credencial nueva en silencio.
 *
 * **El contexto criptografico es propio.** El almacen usa su `context` como AAD,
 * asi que un secreto de identidad de dispositivo no se puede descifrar como
 * credencial fiscal ni al reves, aunque compartan directorio y clave maestra.
 *
 * ## Lo que NO garantiza, y conviene no fingir
 *
 * Los valores se devuelven como `string`, y una cadena de JavaScript no se puede
 * poner a cero: queda en el heap hasta que el recolector pase. El `Buffer` que
 * sale del almacen si se limpia. Reducir esa ventana exigiria mantener el
 * secreto en `Buffer` a lo largo de todo el adapter, lo que hoy contradice la
 * forma de `FactusCredential`. Queda dicho, no disimulado.
 */

/** Prefijo del `secretRef`. Fijo porque el primer segmento no admite `_`. */
const SECRET_REF_PREFIX = "fiscal";

export interface FiscalCredentialDeposit {
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  /** Campos declarados por el adapter, por su nombre exacto. */
  readonly fields: Readonly<Record<string, string>>;
}

interface StoredEnvelope {
  readonly version: string;
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  readonly fields: Readonly<Record<string, string>>;
  readonly depositedAt: string;
}

export class FiscalCredentialNotFoundError extends Error {
  readonly code = "FISCAL_CREDENTIAL_NOT_DEPOSITED";
  constructor(provider: FiscalProvider, environment: FiscalEnvironment) {
    super(`no fiscal credential deposited for ${provider} in ${environment}`);
    this.name = "FiscalCredentialNotFoundError";
  }
}

export class FiscalCredentialVersionMismatchError extends Error {
  readonly code = "FISCAL_CREDENTIAL_VERSION_MISMATCH";
  constructor() {
    // Sin versiones en el mensaje: identifican un secreto vigente.
    super("fiscal credential reference is stale; the credential was rotated");
    this.name = "FiscalCredentialVersionMismatchError";
  }
}

export class FiscalCredentialShapeError extends Error {
  readonly code = "FISCAL_CREDENTIAL_SHAPE";
  constructor(message: string) {
    super(message);
    this.name = "FiscalCredentialShapeError";
  }
}

/** Nombre del secreto en el almacen. Deriva de `(proveedor, ambiente)`. */
export function fiscalSecretName(
  provider: FiscalProvider,
  environment: FiscalEnvironment,
): string {
  return `fc.${provider.toLowerCase()}.${environment.toLowerCase()}`;
}

/** Contexto criptografico (AAD) propio del dominio fiscal. */
export function fiscalCredentialContext(binding: {
  readonly installationId: string;
  readonly deviceId: string;
}): string {
  return `pos-local-service.fiscal-credential.v1:${binding.installationId}:${binding.deviceId}`;
}

function referenceFor(
  provider: FiscalProvider,
  environment: FiscalEnvironment,
  version: string,
): CredentialReference {
  return CredentialReferenceSchema.parse({
    secretRef: `${SECRET_REF_PREFIX}:${provider}:${environment}`,
    version,
  });
}

export class FiscalCredentialStore {
  constructor(
    private readonly secrets: EncryptedFileSecretStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Deposita o rota la credencial. Devuelve la referencia opaca resultante.
   *
   * Valida los nombres de campo contra lo que el adapter declara: depositar una
   * credencial incompleta produciria un fallo de autenticacion mucho mas tarde y
   * mucho mas dificil de leer. Tambien rechaza campos de mas, porque un campo
   * que el adapter no conoce es un valor custodiado que nadie va a usar.
   */
  deposit(input: FiscalCredentialDeposit, requirement: CredentialRequirement): CredentialReference {
    const expected = requirement.fields.map((field) => field.name).sort();
    const supplied = Object.keys(input.fields).sort();
    if (expected.length !== supplied.length || expected.some((name, index) => name !== supplied[index])) {
      // Los nombres son publicos (`fiscal-adapter-gate.md` §12.2); los valores no.
      throw new FiscalCredentialShapeError(
        `fiscal credential fields must be exactly [${expected.join(", ")}]`,
      );
    }
    for (const name of expected) {
      const value = input.fields[name];
      if (typeof value !== "string" || value.length === 0) {
        throw new FiscalCredentialShapeError(`fiscal credential field ${name} must be a non-empty string`);
      }
    }

    const version = randomUUID();
    const envelope: StoredEnvelope = {
      version,
      provider: input.provider,
      environment: input.environment,
      fields: { ...input.fields },
      depositedAt: this.now().toISOString(),
    };
    const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
    try {
      this.secrets.write(fiscalSecretName(input.provider, input.environment), plaintext);
    } finally {
      plaintext.fill(0);
    }
    return referenceFor(input.provider, input.environment, version);
  }

  /** `true` si hay credencial depositada para ese proveedor y ambiente. */
  has(provider: FiscalProvider, environment: FiscalEnvironment): boolean {
    return this.secrets.has(fiscalSecretName(provider, environment));
  }

  /**
   * Referencia vigente. Descifra para leer la version, y **no devuelve valores**.
   *
   * Es la operacion que permite cablear el adapter sin persistir la referencia
   * en ninguna tabla.
   */
  reference(provider: FiscalProvider, environment: FiscalEnvironment): CredentialReference {
    return referenceFor(provider, environment, this.open(provider, environment).version);
  }

  /**
   * Resuelve los campos custodiados.
   *
   * Solo el adapter debe llamar aqui. La referencia se valida entera: proveedor,
   * ambiente y version. Una version que no coincide es una rotacion ocurrida
   * entre medias y falla cerrada.
   */
  resolve(reference: CredentialReference): Readonly<Record<string, string>> {
    const parsed = CredentialReferenceSchema.parse(reference);
    const segments = parsed.secretRef.split(":");
    if (segments.length !== 3 || segments[0] !== SECRET_REF_PREFIX) {
      throw new FiscalCredentialShapeError("fiscal credential reference is not addressable");
    }
    const provider = segments[1] as FiscalProvider;
    const environment = segments[2] as FiscalEnvironment;

    const envelope = this.open(provider, environment);
    if (envelope.version !== parsed.version) throw new FiscalCredentialVersionMismatchError();
    // El sobre guarda tambien proveedor y ambiente: si el fichero se moviera de
    // sitio, la referencia dejaria de resolver en lugar de resolver a otra cosa.
    if (envelope.provider !== provider || envelope.environment !== environment) {
      throw new FiscalCredentialShapeError("stored fiscal credential does not match its location");
    }
    return envelope.fields;
  }

  /** Nombres de los campos secretos declarados, para redactar diagnosticos. */
  static redactableFieldNames(requirement: CredentialRequirement): readonly string[] {
    return secretFieldNames(requirement);
  }

  private open(provider: FiscalProvider, environment: FiscalEnvironment): StoredEnvelope {
    const name = fiscalSecretName(provider, environment);
    if (!this.secrets.has(name)) throw new FiscalCredentialNotFoundError(provider, environment);
    const plaintext = this.secrets.read(name);
    try {
      return JSON.parse(plaintext.toString("utf8")) as StoredEnvelope;
    } finally {
      plaintext.fill(0);
    }
  }
}
