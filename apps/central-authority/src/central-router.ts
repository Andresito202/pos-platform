import type { IncomingMessage, ServerResponse } from "node:http";
type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;
/** Single Central listener: BUSINESS dispatch never falls through to GLOBAL. */
export function createCentralRouter(fallback: Handler, business?: Handler): Handler {
  return async (request, response) => {
    if (request.url === "/business" || request.url?.startsWith("/business/") || request.url?.startsWith("/v1/business/")) {
      if (business) await business(request, response);
      else { response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify({ code: "BUSINESS_NOT_PROVISIONED" })); }
      return;
    }
    await fallback(request, response);
  };
}
