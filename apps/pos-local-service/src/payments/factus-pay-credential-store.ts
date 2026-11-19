import { randomUUID } from "node:crypto";
import type { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";

export type FactusPayEnvironment = "SANDBOX" | "PRODUCTION";

interface StoredEnvelope {
  readonly version: string;
  readonly environment: FactusPayEnvironment;
  readonly companyId: string;
  readonly email: string;
  readonly password: string;
  readonly depositedAt: string;
}

interface CachedTokenEnvelope {
  readonly token: string;
  readonly obtainedAt: string;
}

const SECRET_REF_PREFIX = "factus_pay";

export class FactusPayCredentialNotFoundError extends Error {
  readonly code = "FACTUS_PAY_CREDENTIAL_NOT_DEPOSITED";
  constructor(environment: FactusPayEnvironment, companyId: string) {
    super(`no Factus Pay credential deposited for ${environment} company ${companyId}`);
    this.name = "FactusPayCredentialNotFoundError";
  }
}

export class FactusPayCredentialCompanyMismatchError extends Error {
  readonly code = "FACTUS_PAY_CREDENTIAL_COMPANY_MISMATCH";
  constructor() {
    super("Factus Pay credential does not belong to the authorized company");
    this.name = "FactusPayCredentialCompanyMismatchError";
  }
}

export class FactusPayCredentialShapeError extends Error {
  readonly code = "FACTUS_PAY_CREDENTIAL_SHAPE";
  constructor(message: string) {
    super(message);
    this.name = "FactusPayCredentialShapeError";
  }
}

export function factusPaySecretName(environment: FactusPayEnvironment, companyId: string): string {
  return `fp.${environment.toLowerCase()}.${companyId}`;
}

export function factusPayTokenSecretName(environment: FactusPayEnvironment, companyId: string): string {
  return `fp.token.${environment.toLowerCase()}.${companyId}`;
}

/** AAD distinct from fiscal custody (`SEC-004`). */
export function factusPayCredentialContext(binding: {
  readonly installationId: string;
  readonly deviceId: string;
  readonly companyId: string;
}): string {
  return `pos-local-service.factus-pay-credential.v1:${binding.installationId}:${binding.deviceId}:${binding.companyId}`;
}

export interface FactusPayCredentialDeposit {
  readonly environment: FactusPayEnvironment;
  readonly email: string;
  readonly password: string;
}

export class FactusPayCredentialStore {
  constructor(
    private readonly secrets: EncryptedFileSecretStore,
    private readonly companyId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (companyId.length < 1) throw new FactusPayCredentialShapeError("Factus Pay credential store requires companyId");
  }

  deposit(input: FactusPayCredentialDeposit): { readonly version: string } {
    if (typeof input.email !== "string" || input.email.length < 1 || input.email.length > 256) {
      throw new FactusPayCredentialShapeError("Factus Pay email must be a non-empty string");
    }
    if (typeof input.password !== "string" || input.password.length < 1 || input.password.length > 4096) {
      throw new FactusPayCredentialShapeError("Factus Pay password must be a non-empty string");
    }
    const version = randomUUID();
    const envelope: StoredEnvelope = {
      version,
      environment: input.environment,
      companyId: this.companyId,
      email: input.email,
      password: input.password,
      depositedAt: this.now().toISOString(),
    };
    const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
    try {
      this.secrets.write(factusPaySecretName(input.environment, this.companyId), plaintext);
      this.writeCachedToken(input.environment, "__INVALIDATED__");
    } finally {
      plaintext.fill(0);
    }
    return { version };
  }

  has(environment: FactusPayEnvironment): boolean {
    return this.secrets.has(factusPaySecretName(environment, this.companyId));
  }

  resolveLogin(environment: FactusPayEnvironment): { readonly email: string; readonly password: string } {
    const envelope = this.open(environment);
    return { email: envelope.email, password: envelope.password };
  }

  readCachedToken(environment: FactusPayEnvironment): string | null {
    const name = factusPayTokenSecretName(environment, this.companyId);
    if (!this.secrets.has(name)) return null;
    const plaintext = this.secrets.read(name);
    try {
      const parsed = JSON.parse(plaintext.toString("utf8")) as CachedTokenEnvelope;
      if (typeof parsed.token !== "string" || parsed.token.length < 1 || parsed.token === "__INVALIDATED__" || /[\r\n]/.test(parsed.token)) {
        return null;
      }
      return parsed.token;
    } finally {
      plaintext.fill(0);
    }
  }

  writeCachedToken(environment: FactusPayEnvironment, token: string): void {
    if (typeof token !== "string" || token.length < 1 || token.length > 8192 || /[\r\n]/.test(token)) {
      throw new FactusPayCredentialShapeError("Factus Pay token rejected");
    }
    const envelope: CachedTokenEnvelope = { token, obtainedAt: this.now().toISOString() };
    const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
    try {
      this.secrets.write(factusPayTokenSecretName(environment, this.companyId), plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  clearCachedToken(environment: FactusPayEnvironment): void {
    this.writeCachedToken(environment, "__INVALIDATED__");
  }

  private open(environment: FactusPayEnvironment): StoredEnvelope {
    const name = factusPaySecretName(environment, this.companyId);
    if (!this.secrets.has(name)) throw new FactusPayCredentialNotFoundError(environment, this.companyId);
    const plaintext = this.secrets.read(name);
    try {
      const envelope = JSON.parse(plaintext.toString("utf8")) as StoredEnvelope;
      if (envelope.companyId !== this.companyId) throw new FactusPayCredentialCompanyMismatchError();
      if (envelope.environment !== environment) throw new FactusPayCredentialShapeError("stored credential environment mismatch");
      return envelope;
    } finally {
      plaintext.fill(0);
    }
  }
}