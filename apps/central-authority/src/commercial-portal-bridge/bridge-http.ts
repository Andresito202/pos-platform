import type { IncomingMessage, ServerResponse } from "node:http";
import { COMMERCIAL_BRIDGE_KEY_HEADER } from "@pos-platform/contracts";
import { readCommercialJsonBody, sendCommercialJson } from "../commercial-https-request-boundary.js";
import { CommercialPortalBridgeService } from "./bridge-service.js";
import type { GlobalSessionGate } from "./global-session-gate.js";

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function pathOf(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const q = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}

async function readOptionalJson(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const length = request.headers["content-length"];
  if (length === "0" || length === undefined) return {};
  const { object } = await readCommercialJsonBody(request, maxBytes);
  return object;
}

/**
 * Mounts commercial portal bridge routes on Central Authority.
 * Mint requires bridge key + verified GLOBAL MFA session (gate).
 */
export function createCommercialPortalBridgeHandler(
  bridge: CommercialPortalBridgeService,
  gate: GlobalSessionGate,
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = pathOf(request);
    const isBridgePath =
      path === "/v1/sessions/introspect" ||
      path === "/v1/sessions/commercial-bridge/mint" ||
      path === "/v1/commercial/trial/issue" ||
      path === "/v1/commercial/trial/expire-sweep" ||
      path === "/v1/commercial/provisioning";
    if (!isBridgePath) return false;
    if (request.method !== "POST") {
      sendCommercialJson(response, 405, { code: "METHOD_NOT_ALLOWED" });
      return true;
    }

    try {
      if (path === "/v1/sessions/introspect") {
        const object = await readOptionalJson(request, 4_096);
        const result = await bridge.introspect(header(request, "authorization"), object);
        sendCommercialJson(response, 200, result);
        return true;
      }

      bridge.assertBridgeKey(header(request, COMMERCIAL_BRIDGE_KEY_HEADER));

      if (path === "/v1/sessions/commercial-bridge/mint") {
        const global = await gate.verifyForMint(request);
        if (!global) {
          sendCommercialJson(response, 401, { code: "GLOBAL_SESSION_REQUIRED" });
          return true;
        }
        const { object } = await readCommercialJsonBody(request, 4_096);
        const result = await bridge.mint(object, global);
        sendCommercialJson(response, 200, result);
        return true;
      }

      if (path === "/v1/commercial/trial/issue") {
        const { object } = await readCommercialJsonBody(request, 16_384);
        const result = await bridge.issueTrial(object);
        sendCommercialJson(response, 200, result);
        return true;
      }

      if (path === "/v1/commercial/trial/expire-sweep") {
        await readOptionalJson(request, 1_024);
        const result = await bridge.expireSweep();
        sendCommercialJson(response, 200, result);
        return true;
      }

      if (path === "/v1/commercial/provisioning") {
        const { object } = await readCommercialJsonBody(request, 65_536);
        const idem = header(request, "idempotency-key");
        const result = await bridge.provision(idem, object);
        sendCommercialJson(response, 200, result);
        return true;
      }

      sendCommercialJson(response, 404, { code: "NOT_FOUND" });
      return true;
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? Number((error as { status: number }).status)
          : 400;
      const code = error instanceof Error ? error.message : "COMMERCIAL_BRIDGE_ERROR";
      sendCommercialJson(response, Number.isFinite(status) && status >= 400 ? status : 400, { code });
      return true;
    }
  };
}
