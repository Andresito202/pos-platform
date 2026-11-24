/**
 * LOCAL/integration-only HTTP listener for the commercial portal bridge.
 * Refuses to start when NODE_ENV=production (Central production uses TLS main.ts).
 *
 * Env:
 * - COMMERCIAL_BRIDGE_KEY (≥32)
 * - CENTRAL_TRIAL_WEBHOOK_KEY (≥32)
 * - COMMERCIAL_BRIDGE_PORT (default 18443)
 */
import { createServer } from "node:http";
import {
  CommercialPortalBridgeService,
  MemoryCommercialPortalBridgeStore,
} from "./bridge-service.js";
import { createCommercialPortalBridgeHandler } from "./bridge-http.js";

if (process.env.NODE_ENV === "production") {
  console.error("standalone commercial bridge refused in production — use central-authority TLS");
  process.exit(1);
}

const bridgeKey = process.env.COMMERCIAL_BRIDGE_KEY ?? "";
const trialWebhookKey = process.env.CENTRAL_TRIAL_WEBHOOK_KEY ?? "";
const port = Number(process.env.COMMERCIAL_BRIDGE_PORT ?? "18443");

const bridge = new CommercialPortalBridgeService(new MemoryCommercialPortalBridgeStore(), {
  bridgeKey,
  trialWebhookKey,
});
const handle = createCommercialPortalBridgeHandler(bridge);

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ status: "OK", service: "commercial-portal-bridge-standalone" }));
    return;
  }
  const handled = await handle(req, res);
  if (!handled) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "NOT_FOUND" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    JSON.stringify({ service: "commercial-portal-bridge-standalone", status: "LISTENING", port }) + "\n",
  );
});
