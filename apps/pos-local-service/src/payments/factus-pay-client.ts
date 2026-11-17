import {
  FactusPayCredentialNotFoundError,
  FactusPayCredentialStore,
  type FactusPayEnvironment,
} from "./factus-pay-credential-store.js";
import { factusPayAmountToScale6, scale6ToFactusPayAmount } from "./factus-pay-amount.js";

const ORIGINS: Record<FactusPayEnvironment, string> = {
  SANDBOX: "https://pay-api-sandbox.factus.com.co",
  PRODUCTION: "https://pay-api.factus.com.co",
};

export interface FactusPayCollectionDetail {
  readonly referenceCode: string;
  readonly amountScale6: string;
  readonly status: string;
  readonly qr: string | null;
  readonly currencyCode: string;
}

export class FactusPayClientError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "FactusPayClientError";
  }
}

export class FactusPayClient {
  private authChain: Promise<void> = Promise.resolve();
  private cachedToken: string | null = null;

  constructor(
    private readonly credentials: FactusPayCredentialStore,
    private readonly environment: FactusPayEnvironment,
    private readonly now: () => Date = () => new Date(),
    private readonly transport: typeof fetch = fetch,
    private readonly requestTimeoutMs = 20_000,
    private readonly maximumResponseBytes = 1_048_576,
  ) {}

  async createCollection(input: {
    readonly referenceCode: string;
    readonly amountScale6: string;
    readonly expirationSeconds: number;
    readonly signal?: AbortSignal;
  }): Promise<FactusPayCollectionDetail> {
    if (input.referenceCode.length < 1 || input.referenceCode.length > 100) {
      throw new FactusPayClientError("FACTUS_PAY_REFERENCE_INVALID");
    }
    if (!Number.isInteger(input.expirationSeconds) || input.expirationSeconds <= 0) {
      throw new FactusPayClientError("FACTUS_PAY_EXPIRATION_INVALID");
    }
    let providerAmount: string;
    try {
      providerAmount = scale6ToFactusPayAmount(input.amountScale6);
    } catch {
      throw new FactusPayClientError("FACTUS_PAY_AMOUNT_INVALID");
    }
    const token = await this.authenticate(input.signal);
    const origin = ORIGINS[this.environment];
    const url = `${origin}/v1/collections`;
    const response = await this.request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        reference_code: input.referenceCode,
        amount: providerAmount,
        expiration: String(input.expirationSeconds),
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const body = await this.readJson(response, input.signal);
    return this.parseCollection(body, input.amountScale6, input.referenceCode);
  }

  async getCollection(input: {
    readonly referenceCode: string;
    readonly expectedAmountScale6: string;
    readonly signal?: AbortSignal;
  }): Promise<FactusPayCollectionDetail> {
    const token = await this.authenticate(input.signal);
    const origin = ORIGINS[this.environment];
    const url = `${origin}/v1/collections/${encodeURIComponent(input.referenceCode)}`;
    const response = await this.request(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const body = await this.readJson(response, input.signal);
    const detail = this.parseCollection(body, input.expectedAmountScale6, input.referenceCode);
    if (detail.referenceCode !== input.referenceCode) throw new FactusPayClientError("FACTUS_PAY_REFERENCE_MISMATCH");
    if (detail.amountScale6 !== input.expectedAmountScale6) throw new FactusPayClientError("FACTUS_PAY_AMOUNT_MISMATCH");
    return detail;
  }

  private parseCollection(
    body: unknown,
    expectedAmountScale6: string,
    expectedReference: string,
  ): FactusPayCollectionDetail {
    if (typeof body !== "object" || body === null || !("status" in body) || (body as { status: unknown }).status !== "success") {
      throw new FactusPayClientError("FACTUS_PAY_RESPONSE_REJECTED");
    }
    const data = (body as { data?: unknown }).data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new FactusPayClientError("FACTUS_PAY_COLLECTION_REJECTED");
    }
    const row = data as Record<string, unknown>;
    const referenceCode = row.reference_code;
    const status = row.status;
    const amount = row.amount;
    if (typeof referenceCode !== "string" || referenceCode !== expectedReference) {
      throw new FactusPayClientError("FACTUS_PAY_REFERENCE_MISMATCH");
    }
    if (typeof status !== "string") throw new FactusPayClientError("FACTUS_PAY_COLLECTION_REJECTED");
    let amountScale6: string;
    try {
      amountScale6 = factusPayAmountToScale6(String(amount));
    } catch {
      throw new FactusPayClientError("FACTUS_PAY_AMOUNT_INVALID");
    }
    if (amountScale6 !== expectedAmountScale6) throw new FactusPayClientError("FACTUS_PAY_AMOUNT_MISMATCH");
    const currencyCode = row.currency_code === undefined ? "COP" : String(row.currency_code);
    if (currencyCode !== "COP") throw new FactusPayClientError("FACTUS_PAY_CURRENCY_MISMATCH");
    const qr = row.qr === undefined || row.qr === null ? null : String(row.qr);
    if (qr !== null && (qr.length > this.maximumResponseBytes || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(qr))) {
      throw new FactusPayClientError("FACTUS_PAY_QR_REJECTED");
    }
    return {
      referenceCode,
      amountScale6,
      status,
      qr,
      currencyCode,
    };
  }

  private async authenticate(signal?: AbortSignal): Promise<string> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.authChain;
    this.authChain = previous.then(() => gate);
    await previous;
    try {
      if (this.cachedToken !== null) return this.cachedToken;
      const stored = this.credentials.readCachedToken(this.environment);
      if (stored !== null) {
        this.cachedToken = stored;
        return stored;
      }
      let login: { email: string; password: string };
      try {
        login = this.credentials.resolveLogin(this.environment);
      } catch (error) {
        if (error instanceof FactusPayCredentialNotFoundError) {
          throw new FactusPayClientError("FACTUS_PAY_NOT_CONFIGURED");
        }
        throw error;
      }
      const origin = ORIGINS[this.environment];
      const response = await this.request(`${origin}/auth`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ email: login.email, password: login.password }),
        ...(signal === undefined ? {} : { signal }),
      });
      const body = await this.readJson(response, signal);
      const token = (body as { token?: unknown }).token;
      if (typeof token !== "string" || token.length < 1 || token.length > 8192 || /[\r\n]/.test(token)) {
        throw new FactusPayClientError("FACTUS_PAY_AUTH_REJECTED");
      }
      this.cachedToken = token;
      this.credentials.writeCachedToken(this.environment, token);
      return token;
    } catch (error) {
      this.cachedToken = null;
      this.credentials.clearCachedToken(this.environment);
      if (error instanceof FactusPayClientError) throw error;
      throw new FactusPayClientError("FACTUS_PAY_AUTH_FAILED");
    } finally {
      release();
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const parent = init.signal;
    const onAbort = (): void => controller.abort();
    parent?.addEventListener("abort", onAbort, { once: true });
  try {
      const response = await this.transport(url, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.redirected) throw new FactusPayClientError("FACTUS_PAY_RESPONSE_REJECTED");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== undefined && contentType !== "" && contentType !== "application/json") {
        throw new FactusPayClientError("FACTUS_PAY_CONTENT_TYPE_REJECTED");
      }
      if (response.status === 401) throw new FactusPayClientError("FACTUS_PAY_UNAUTHORIZED");
      if (![200, 201].includes(response.status)) throw new FactusPayClientError("FACTUS_PAY_RESPONSE_REJECTED");
      return response;
    } catch (error) {
      if (controller.signal.aborted) throw new FactusPayClientError("FACTUS_PAY_CANCELLED_OR_TIMEOUT");
      if (error instanceof FactusPayClientError) throw error;
      throw new FactusPayClientError("FACTUS_PAY_TRANSPORT_FAILED");
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    }
  }

  private async readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
    const reader = response.body?.getReader();
    if (reader === undefined) throw new FactusPayClientError("FACTUS_PAY_RESPONSE_REJECTED");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > this.maximumResponseBytes) throw new FactusPayClientError("FACTUS_PAY_RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      chunks.length === 1 ? chunks[0]! : Uint8Array.from(chunks.flatMap((c) => [...c])),
    );
    return JSON.parse(text) as unknown;
  }
}