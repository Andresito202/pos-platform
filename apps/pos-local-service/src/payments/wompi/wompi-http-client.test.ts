import { describe, expect, it } from "vitest";
import {
  WompiHttpError,
  WompiMalformedResponseError,
  WompiNetworkError,
  WompiTimeoutError,
  WompiTransactionNotFoundError,
  getWompiTransaction,
} from "./wompi-http-client.js";

const credentials = { privateKey: "prv_test_12345" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("getWompiTransaction", () => {
  it("queries GET /v1/transactions/{id} with a bearer private key and returns an approved transaction", async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = new Headers(init?.headers).get("authorization");
      return jsonResponse(200, {
        data: {
          id: "txn-1",
          reference: "order-249",
          status: "APPROVED",
          amount_in_cents: 2490000,
          currency: "COP",
        },
      });
    }) as typeof fetch;

    const transaction = await getWompiTransaction("txn-1", credentials, { fetchImpl });

    expect(capturedUrl).toBe("https://production.wompi.co/v1/transactions/txn-1");
    expect(capturedAuth).toBe("Bearer prv_test_12345");
    expect(transaction.status).toBe("APPROVED");
    expect(transaction.id).toBe("txn-1");
  });

  it("returns a pending transaction as-is", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        data: {
          id: "txn-2",
          reference: "order-2",
          status: "PENDING",
          amount_in_cents: 1000,
          currency: "COP",
        },
      })) as typeof fetch;

    const transaction = await getWompiTransaction("txn-2", credentials, { fetchImpl });
    expect(transaction.status).toBe("PENDING");
  });

  it("returns a declined/rejected transaction as-is", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        data: {
          id: "txn-3",
          reference: "order-3",
          status: "DECLINED",
          amount_in_cents: 1000,
          currency: "COP",
        },
      })) as typeof fetch;

    const transaction = await getWompiTransaction("txn-3", credentials, { fetchImpl });
    expect(transaction.status).toBe("DECLINED");
  });

  it("throws WompiTransactionNotFoundError on HTTP 404", async () => {
    const fetchImpl = (async () =>
      textResponse(404, JSON.stringify({ error: { type: "NOT_FOUND" } }))) as typeof fetch;

    await expect(getWompiTransaction("missing-txn", credentials, { fetchImpl }))
      .rejects.toBeInstanceOf(WompiTransactionNotFoundError);
  });

  it("throws WompiHttpError on other non-2xx responses", async () => {
    const fetchImpl = (async () => textResponse(500, "internal error")) as typeof fetch;

    await expect(getWompiTransaction("txn-1", credentials, { fetchImpl }))
      .rejects.toBeInstanceOf(WompiHttpError);
  });

  it("throws WompiMalformedResponseError when the body is not valid JSON", async () => {
    const fetchImpl = (async () => textResponse(200, "<html>not json</html>")) as typeof fetch;

    await expect(getWompiTransaction("txn-1", credentials, { fetchImpl }))
      .rejects.toBeInstanceOf(WompiMalformedResponseError);
  });

  it("throws WompiMalformedResponseError when the body does not match the transaction shape", async () => {
    const fetchImpl = (async () => jsonResponse(200, { data: { unexpected: true } })) as typeof fetch;

    await expect(getWompiTransaction("txn-1", credentials, { fetchImpl }))
      .rejects.toBeInstanceOf(WompiMalformedResponseError);
  });

  it("throws WompiMalformedResponseError for an unknown transaction status rather than guessing", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        data: {
          id: "txn-1",
          reference: "order-1",
          status: "SOME_FUTURE_STATUS",
          amount_in_cents: 1000,
          currency: "COP",
        },
      })) as typeof fetch;

    await expect(getWompiTransaction("txn-1", credentials, { fetchImpl }))
      .rejects.toBeInstanceOf(WompiMalformedResponseError);
  });

  it("throws WompiNetworkError when the request fails before a response arrives", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND production.wompi.co");
    }) as typeof fetch;

    await expect(getWompiTransaction("txn-1", credentials, { fetchImpl }))
      .rejects.toBeInstanceOf(WompiNetworkError);
  });

  it("throws WompiTimeoutError when the request does not complete before the deadline", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      })) as typeof fetch;

    await expect(getWompiTransaction("txn-1", credentials, { fetchImpl, timeoutMs: 5 }))
      .rejects.toBeInstanceOf(WompiTimeoutError);
  });
});
