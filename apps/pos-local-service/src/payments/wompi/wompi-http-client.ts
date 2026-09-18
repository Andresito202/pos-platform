import * as z from "zod";
import { WompiTransactionSchema, type WompiTransaction } from "./wompi-transaction.js";

export interface WompiApiCredentials {
  /**
   * Wompi's documented status-query endpoint authenticates with the
   * PUBLIC key (`Authorization: Bearer pub_(test|prod)_...`), not the
   * private key — verified against Wompi's own docs, not assumed. It is
   * the same public key already used to build the checkout URL.
   */
  readonly publicKey: string;
  /** Overridable for tests; Wompi serves both test and live keys from the same host. */
  readonly baseUrl?: string;
}

const DEFAULT_WOMPI_BASE_URL = "https://production.wompi.co/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export class WompiTransactionNotFoundError extends Error {
  constructor(readonly transactionId: string) {
    super(`Wompi transaction '${transactionId}' was not found`);
    this.name = "WompiTransactionNotFoundError";
  }
}

export class WompiHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Wompi API responded with HTTP ${status}`);
    this.name = "WompiHttpError";
  }
}

export class WompiNetworkError extends Error {
  constructor(cause: unknown) {
    super("Wompi API request failed before receiving a response");
    this.name = "WompiNetworkError";
    this.cause = cause;
  }
}

export class WompiTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Wompi API request timed out after ${timeoutMs}ms`);
    this.name = "WompiTimeoutError";
  }
}

export class WompiMalformedResponseError extends Error {
  constructor(reason: string, readonly body: string) {
    super(`Wompi API returned a malformed response: ${reason}`);
    this.name = "WompiMalformedResponseError";
  }
}

const WompiTransactionEnvelopeSchema = z.object({
  data: WompiTransactionSchema,
});

export interface WompiHttpClientDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * `GET /v1/transactions/{id}` — Wompi is the financial authority; this is
 * the only real query surface this task authorizes. `id` must be the
 * Wompi-issued transaction id (from a checkout redirect or a verified
 * webhook), never the merchant-generated reference used at intent creation.
 */
export async function getWompiTransaction(
  transactionId: string,
  credentials: WompiApiCredentials,
  dependencies: WompiHttpClientDependencies = {},
): Promise<WompiTransaction> {
  if (!transactionId.trim()) throw new Error("Wompi transaction id is required");
  if (!credentials.publicKey) throw new Error("Wompi public key is required");

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = credentials.baseUrl ?? DEFAULT_WOMPI_BASE_URL;
  const url = `${baseUrl}/transactions/${encodeURIComponent(transactionId)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${credentials.publicKey}` },
      signal: controller.signal,
    });
  } catch (cause: unknown) {
    if (controller.signal.aborted) throw new WompiTimeoutError(timeoutMs);
    throw new WompiNetworkError(cause);
  } finally {
    clearTimeout(timeout);
  }

  const rawBody = await response.text();

  if (response.status === 404) {
    throw new WompiTransactionNotFoundError(transactionId);
  }
  if (!response.ok) {
    throw new WompiHttpError(response.status, rawBody);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new WompiMalformedResponseError("body is not valid JSON", rawBody);
  }

  const parsed = WompiTransactionEnvelopeSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new WompiMalformedResponseError(
      `body does not match the expected transaction shape: ${parsed.error.message}`,
      rawBody,
    );
  }

  return parsed.data.data;
}
