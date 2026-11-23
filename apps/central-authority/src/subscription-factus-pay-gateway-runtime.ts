import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { SubscriptionFactusPayGatewayProvisionSchema } from "@pos-platform/contracts";
import {
  createHttpSubscriptionFactusPayGateway,
} from "./subscription-factus-pay-http-gateway.js";
import {
  SubscriptionFactusPayGatewayError,
  type SubscriptionFactusPayGateway,
} from "./subscription-factus-pay-gateway.js";

const CredentialFileSchema = {
  parse(raw: unknown): { email: string; password: string } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw Error("SUBSCRIPTION_FACTUS_PAY_CREDENTIAL_REJECTED");
    }
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).length !== 2) throw Error("SUBSCRIPTION_FACTUS_PAY_CREDENTIAL_REJECTED");
    if (typeof row.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length > 320) {
      throw Error("SUBSCRIPTION_FACTUS_PAY_CREDENTIAL_REJECTED");
    }
    if (typeof row.password !== "string" || row.password.length < 8 || row.password.length > 512) {
      throw Error("SUBSCRIPTION_FACTUS_PAY_CREDENTIAL_REJECTED");
    }
    return { email: row.email.trim(), password: row.password };
  },
};

const ORIGINS = {
  SANDBOX: "https://pay-api-sandbox.factus.com.co",
  PRODUCTION: "https://pay-api.factus.com.co",
} as const;

function managed(path: string, max: number): string {
  if (!isAbsolute(path)) throw Error("SUBSCRIPTION_FACTUS_PAY_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max
    || process.platform !== "win32" && (s.mode & 0o077) !== 0) {
    throw Error("SUBSCRIPTION_FACTUS_PAY_MANAGED_FILE_REJECTED");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

/**
 * Builds the official subscription Factus Pay GET/open gateway from managed
 * custody. No simulated paid status; tokens never enter browser or argv.
 */
export function prepareSubscriptionFactusPayGateway(path: string): SubscriptionFactusPayGateway {
  const provision = SubscriptionFactusPayGatewayProvisionSchema.parse(
    JSON.parse(managed(path, 16_384)),
  );
  const login = CredentialFileSchema.parse(JSON.parse(managed(provision.credential_file, 4_096)));
  const origin = ORIGINS[provision.environment];
  let cachedToken: string | null = null;
  let authChain: Promise<void> = Promise.resolve();

  async function resolveAccessToken(): Promise<string> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const previous = authChain;
    authChain = previous.then(() => gate);
    await previous;
    try {
      if (cachedToken !== null) return cachedToken;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), provision.request_timeout_ms);
      try {
        const response = await fetch(`${origin}/auth`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ email: login.email, password: login.password }),
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_UNAUTHORIZED");
        }
        if (response.status !== 200 || response.redirected) {
          void response.body?.cancel().catch(() => undefined);
          throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_AUTH_REJECTED");
        }
        const body = JSON.parse(Buffer.from(await response.arrayBuffer()).toString("utf8")) as {
          token?: unknown;
        };
        const token = body.token;
        if (typeof token !== "string" || token.length < 1 || token.length > 8192 || /[\r\n]/.test(token)) {
          throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_AUTH_REJECTED");
        }
        cachedToken = token;
        return token;
      } catch (error) {
        cachedToken = null;
        if (error instanceof SubscriptionFactusPayGatewayError) throw error;
        throw new SubscriptionFactusPayGatewayError("FACTUS_PAY_TRANSPORT_FAILED");
      } finally {
        clearTimeout(timer);
      }
    } finally {
      release();
    }
  }

  return createHttpSubscriptionFactusPayGateway({
    environment: provision.environment,
    resolveAccessToken,
    requestTimeoutMs: provision.request_timeout_ms,
    maximumResponseBytes: provision.maximum_response_bytes,
  });
}
