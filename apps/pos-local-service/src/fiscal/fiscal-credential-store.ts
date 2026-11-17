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
 * Alcance autorizado: `(proveedor, ambiente, companyId)`. Una caja/instalación
 * no puede resolver ni depositar la credencial de otra empresa: el nombre del
 * secreto y el AAD incluyen `companyId` del contexto de servicio (`POS_COMPANY_ID`).
 *
 * No se duplica el almacén cifrado: se reutiliza `EncryptedFileSecretStore` con
 * contexto AAD propio del dominio fiscal (v2 = company-scoped).
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
  readonly companyId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly depositedAt: string;
}

export class FiscalCredentialNotFoundError extends Error {
  readonly code = "FISCAL_CREDENTIAL_NOT_DEPOSITED";
  constructor(provider: FiscalProvider, environment: FiscalEnvironment, companyId: string) {
    super(`no fiscal credential deposited for ${provider} in ${environment} company ${companyId}`);
    this.name = "FiscalCredentialNotFoundError";
  }
}

export class FiscalCredentialVersionMismatchError extends Error {
  readonly code = "FISCAL_CREDENTIAL_VERSION_MISMATCH";
  constructor() {
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

export class FiscalCredentialCompanyMismatchError extends Error {
  readonly code = "FISCAL_CREDENTIAL_COMPANY_MISMATCH";
  constructor() {
    super("fiscal credential does not belong to the authorized company");
    this.name = "FiscalCredentialCompanyMismatchError";
  }
}

/** Nombre del secreto: `(proveedor, ambiente, empresa)`. */
export function fiscalSecretName(
  provider: FiscalProvider,
  environment: FiscalEnvironment,
  companyId: string,
): string {
  return `fc.${provider.toLowerCase()}.${environment.toLowerCase()}.${companyId}`;
}

/**
 * AAD fiscal v2 — incluye empresa autorizada.
 * Los depósitos v1 (sólo instalación/dispositivo) no se descifran aquí a propósito:
 * el operador debe redepositar bajo el alcance de empresa.
 */
export function fiscalCredentialContext(binding: {
  readonly installationId: string;
  readonly deviceId: string;
  readonly companyId: string;
}): string {
  return `pos-local-service.fiscal-credential.v2:${binding.installationId}:${binding.deviceId}:${binding.companyId}`;
}

function referenceFor(
  provider: FiscalProvider,
  environment: FiscalEnvironment,
  companyId: string,
  version: string,
): CredentialReference {
  return CredentialReferenceSchema.parse({
    secretRef: `${SECRET_REF_PREFIX}:${provider}:${environment}:${companyId}`,
    version,
  });
}

export class FiscalCredentialStore {
  constructor(
    private readonly secrets: EncryptedFileSecretStore,
    private readonly companyId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (typeof companyId !== "string" || companyId.length < 1) {
      throw new FiscalCredentialShapeError("fiscal credential store requires an authorized companyId");
    }
  }

  deposit(input: FiscalCredentialDeposit, requirement: CredentialRequirement): CredentialReference {
    const expected = requirement.fields.map((field) => field.name).sort();
    const supplied = Object.keys(input.fields).sort();
    if (expected.length !== supplied.length || expected.some((name, index) => name !== supplied[index])) {
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
      companyId: this.companyId,
      fields: { ...input.fields },
      depositedAt: this.now().toISOString(),
    };
    const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
    try {
      this.secrets.write(fiscalSecretName(input.provider, input.environment, this.companyId), plaintext);
    } finally {
      plaintext.fill(0);
    }
    return referenceFor(input.provider, input.environment, this.companyId, version);
  }

  has(provider: FiscalProvider, environment: FiscalEnvironment): boolean {
    return this.secrets.has(fiscalSecretName(provider, environment, this.companyId));
  }

  reference(provider: FiscalProvider, environment: FiscalEnvironment): CredentialReference {
    return referenceFor(provider, environment, this.companyId, this.open(provider, environment).version);
  }

  resolve(reference: CredentialReference): Readonly<Record<string, string>> {
    const parsed = CredentialReferenceSchema.parse(reference);
    const segments = parsed.secretRef.split(":");
    if (segments.length !== 4 || segments[0] !== SECRET_REF_PREFIX) {
      throw new FiscalCredentialShapeError("fiscal credential reference is not addressable");
    }
    const provider = segments[1] as FiscalProvider;
    const environment = segments[2] as FiscalEnvironment;
    const companyId = segments[3]!;
    if (companyId !== this.companyId) throw new FiscalCredentialCompanyMismatchError();

    const envelope = this.open(provider, environment);
    if (envelope.version !== parsed.version) throw new FiscalCredentialVersionMismatchError();
    if (
      envelope.provider !== provider
      || envelope.environment !== environment
      || envelope.companyId !== this.companyId
    ) {
      throw new FiscalCredentialShapeError("stored fiscal credential does not match its location");
    }
    return envelope.fields;
  }

  static redactableFieldNames(requirement: CredentialRequirement): readonly string[] {
    return secretFieldNames(requirement);
  }

  private open(provider: FiscalProvider, environment: FiscalEnvironment): StoredEnvelope {
    const name = fiscalSecretName(provider, environment, this.companyId);
    if (!this.secrets.has(name)) {
      throw new FiscalCredentialNotFoundError(provider, environment, this.companyId);
    }
    const plaintext = this.secrets.read(name);
    try {
      return JSON.parse(plaintext.toString("utf8")) as StoredEnvelope;
    } finally {
      plaintext.fill(0);
    }
  }
}
