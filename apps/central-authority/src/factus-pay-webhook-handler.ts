import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyFactusPayCollectionWebhook } from "./factus-pay-collection-event.js";
import type { QrPaymentObservation } from "@pos-platform/contracts";

export const FACTUS_PAY_COLLECTION_WEBHOOK_PATH = "/v1/webhooks/factus-pay/collections";
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export interface FactusPayWebhookInbox {
  /**
   * Must commit the normalized observation and provider transaction deduplication
   * key durably before resolving. It must not confirm a POS payment.
   */
  persistVerifiedObservation(
    observation: QrPaymentObservation,
    idempotencyKey: string,
  ): Promise<"STORED" | "DUPLICATE">;
}

export interface FactusPayWebhookHandlerOptions {
  expectedKey: string;
  inbox: FactusPayWebhookInbox;
  maxBodyBytes?: number;
  now?: () => Date;
}

function send(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": "0",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  response.end();
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("FACTUS_PAY_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function publicErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) return 400;
  if (error.message === "FACTUS_PAY_UNAUTHORIZED" || error.message === "FACTUS_PAY_WEBHOOK_KEY_TOO_SHORT") return 401;
  if (error.message === "FACTUS_PAY_BODY_TOO_LARGE") return 413;
  return 400;
}

/**
 * HTTP transport adapter for the Factus Pay collection webhook.
 *
 * A 2xx response is emitted only after the inbox persistence promise resolves.
 * The injected inbox implementation is responsible for a real durable commit;
 * an in-memory implementation is suitable for tests only.
 */
export function createFactusPayWebhookHandler(options: FactusPayWebhookHandlerOptions) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error("FACTUS_PAY_INVALID_BODY_LIMIT");
  }
  if (options.expectedKey.length < 32) throw new Error("FACTUS_PAY_WEBHOOK_KEY_TOO_SHORT");

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      send(response, 405);
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url ?? "/", "https://webhook.invalid");
    } catch {
      send(response, 400);
      return;
    }
    if (url.pathname !== FACTUS_PAY_COLLECTION_WEBHOOK_PATH) {
      send(response, 404);
      return;
    }

    const keys = url.searchParams.getAll("key");
    if (keys.length !== 1 || keys[0] === "") {
      send(response, 401);
      return;
    }

    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      send(response, 415);
      return;
    }

    let observation: QrPaymentObservation;
    try {
      const rawBody = await readBody(request, maxBodyBytes);
      let input: unknown;
      try {
        input = JSON.parse(rawBody) as unknown;
      } catch {
        send(response, 400);
        return;
      }

      observation = verifyFactusPayCollectionWebhook(
        input,
        keys[0] ?? null,
        options.expectedKey,
        (options.now ?? (() => new Date()))(),
      );
    } catch (error) {
      send(response, publicErrorStatus(error));
      return;
    }

    // This await is the acknowledgement boundary: failures return 503 so
    // Factus Pay can retry; 2xx means the event is durably recorded.
    try {
      await options.inbox.persistVerifiedObservation(
        observation,
        "FACTUS_PAY:" + observation.external_transaction_id,
      );
    } catch {
      // Do not expose persistence errors, SQL details, or secret material.
      send(response, 503);
      return;
    }
    send(response, 204);
  };
}
