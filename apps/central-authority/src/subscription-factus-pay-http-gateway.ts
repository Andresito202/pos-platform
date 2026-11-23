import {
  SubscriptionFactusPayGatewayError,
  type SubscriptionFactusPayCollection,
  type SubscriptionFactusPayGateway,
} from "./subscription-factus-pay-gateway.js";

const ORIGINS = {
  SANDBOX: "https://pay-api-sandbox.factus.com.co",
  PRODUCTION: "https://pay-api.factus.com.co",
} as const;

/**
 * Thin HTTP adapter over the same Factus Pay collection API used by POS Caja.
 * Tokens come from managed custody (never from the browser). Without this
 * gateway Central stays fail-closed: quotes remain PENDING and only a durable
 * webhook inbox observation can confirm payment.
 */
export function createHttpSubscriptionFactusPayGateway(input: {
  readonly environment: keyof typeof ORIGINS;
  readonly resolveAccessToken: () => Promise<string>;
  readonly transport?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly maximumResponseBytes?: number;
}): SubscriptionFactusPayGateway {
  const transport = input.transport ?? fetch;
  const timeoutMs = input.requestTimeoutMs ?? 20_000;
  const maxBytes = input.maximumResponseBytes ?? 1_048_576;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_GATEWAY_LIMITS_REQUIRED");
  }
  const origin = ORIGINS[input.environment];

  async function authorizedJson(url: string, init: RequestInit): Promise<unknown> {
    const token = await input.resolveAccessToken();
    if (typeof token !== "string" || token.length < 1 || token.length > 8192 || /[\r\n]/.test(token)) {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_UNAUTHORIZED");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("accept", "application/json");
      const response = await transport(url, {
        ...init,
        headers,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 404) throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_COLLECTION_NOT_FOUND");
      if (response.status === 401) throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_UNAUTHORIZED");
      if (![200, 201].includes(response.status) || response.redirected) {
        void response.body?.cancel().catch(() => undefined);
        throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_RESPONSE_REJECTED");
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_RESPONSE_TOO_LARGE");
      return JSON.parse(buffer.toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof SubscriptionFactusPayGatewayError) throw error;
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_TRANSPORT_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }

  function parseCollection(body: unknown, expectedReference: string, expectedAmountScale6: string): SubscriptionFactusPayCollection {
    if (typeof body !== "object" || body === null || (body as { status?: unknown }).status !== "success") {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_RESPONSE_REJECTED");
    }
    const data = (body as { data?: unknown }).data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_COLLECTION_REJECTED");
    }
    const row = data as Record<string, unknown>;
    if (typeof row.reference_code !== "string" || row.reference_code !== expectedReference) {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_REFERENCE_MISMATCH");
    }
    if (typeof row.status !== "string") throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_COLLECTION_REJECTED");
    const amountText = String(row.amount);
    if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/.test(amountText)) {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_AMOUNT_INVALID");
    }
    const [whole, frac = ""] = amountText.split(".");
    const amountScale6 = `${whole}.${frac.padEnd(6, "0").slice(0, 6)}`;
    if (amountScale6 !== expectedAmountScale6) {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_AMOUNT_MISMATCH");
    }
    const currencyCode = row.currency_code === undefined ? "COP" : String(row.currency_code);
    if (currencyCode !== "COP") throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_CURRENCY_MISMATCH");
    const qr = row.qr === undefined || row.qr === null ? null : String(row.qr);
    if (qr !== null && (qr.length > maxBytes || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(qr))) {
      throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_QR_REJECTED");
    }
    return {
      referenceCode: expectedReference,
      amountScale6,
      status: row.status,
      qr,
      currencyCode: "COP",
    };
  }

  return {
    async recoverOrCreateCollection(request) {
      const getUrl = `${origin}/v1/collections/${encodeURIComponent(request.referenceCode)}`;
      try {
        const existing = parseCollection(
          await authorizedJson(getUrl, { method: "GET" }),
          request.referenceCode,
          request.amountScale6,
        );
        return existing;
      } catch (error) {
        if (!(error instanceof SubscriptionFactusPayGatewayError) || error.code !== "FACTUS_PAY_COLLECTION_NOT_FOUND") {
          throw error;
        }
      }
      const [whole, frac = ""] = request.amountScale6.split(".");
      const providerAmount = frac.replace(/0+$/, "") === "" ? whole : `${whole}.${frac.replace(/0+$/, "")}`;
      const created = await authorizedJson(`${origin}/v1/collections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reference_code: request.referenceCode,
          amount: providerAmount,
          expiration: String(request.expirationSeconds),
        }),
      });
      return parseCollection(created, request.referenceCode, request.amountScale6);
    },
    async getCollection(request) {
      const url = `${origin}/v1/collections/${encodeURIComponent(request.referenceCode)}`;
      return parseCollection(
        await authorizedJson(url, { method: "GET" }),
        request.referenceCode,
        request.expectedAmountScale6,
      );
    },
  };
}
