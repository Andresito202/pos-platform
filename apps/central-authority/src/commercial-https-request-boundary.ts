/**
 * Tip #106 request-boundary helpers recovered from isolated-commercial-https.ts
 * (send / strictHeaders / body) without the frozen commercial HTTPS composition.
 * License activation reuses this boundary; SCM commercial routes stay excluded.
 */
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { IncomingMessage, ServerResponse } from "node:http";

type ObjectBody = Record<string, unknown>;

class Rejection extends Error {
  constructor(readonly status: number) {
    super("COMMERCIAL_REQUEST_REJECTED");
  }
}

function send(res: ServerResponse, status: number, body: unknown, cookie?: string) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "cross-origin-resource-policy": "same-origin",
    ...(cookie ? { "set-cookie": cookie } : {}),
    ...(status === 429 ? { "retry-after": "60" } : {}),
  });
  res.end(payload);
}

function strictHeaders(req: IncomingMessage) {
  const seen = new Set<string>();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]!.toLowerCase();
    if (seen.has(name) || name.startsWith("x-forwarded-") || name === "forwarded") {
      throw new Rejection(400);
    }
    seen.add(name);
  }
  if (req.headers["transfer-encoding"] || req.headers["content-encoding"]) {
    throw new Rejection(400);
  }
}

async function body(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ object: ObjectBody; raw: string }> {
  if (req.headers["content-type"] !== "application/json") throw new Rejection(415);
  const length = req.headers["content-length"];
  if (typeof length !== "string" || !/^\d+$/.test(length)) throw new Rejection(400);
  if (Number(length) > maxBytes) throw new Rejection(413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    bytes += b.length;
    if (bytes > maxBytes) throw new Rejection(413);
    chunks.push(b);
  }
  let value: unknown;
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    value = JSON.parse(raw);
  } catch {
    throw new Rejection(400);
  }
  // JSON.parse otherwise accepts duplicate names, including escaped aliases.
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{" || raw[i] === "[") {
      stack.push(raw[i] === "{" ? new Set() : null);
      if (stack.length > 32) throw new Rejection(400);
    } else if (raw[i] === "}" || raw[i] === "]") stack.pop();
    else if (raw[i] === '"') {
      const start = i++;
      for (; i < raw.length; i++) {
        if (raw[i] === "\\") i++;
        else if (raw[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(raw[next] ?? "x")) next++;
      const frame = stack.at(-1);
      if (raw[next] === ":" && frame) {
        const key = JSON.parse(raw.slice(start, i + 1)) as string;
        if (frame.has(key)) throw new Rejection(400);
        frame.add(key);
      }
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Rejection(400);
  return { object: value as ObjectBody, raw };
}

const exact = (value: ObjectBody, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export function validateCommercialAssertion(value:unknown):value is AuthenticationResponseJSON{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as ObjectBody;
  if(!(exact(v,["id","rawId","type","clientExtensionResults","response"])||
      exact(v,["id","rawId","type","clientExtensionResults","response","authenticatorAttachment"])&&
      ["platform","cross-platform"].includes(v.authenticatorAttachment as string))||v.type!=="public-key"||
    !text(v.id,2048)||v.rawId!==v.id||!v.clientExtensionResults||typeof v.clientExtensionResults!=="object"||
    Array.isArray(v.clientExtensionResults)||Object.keys(v.clientExtensionResults).length!==0||
    !v.response||typeof v.response!=="object"||Array.isArray(v.response))return false;
  const r=v.response as ObjectBody;
  return (exact(r,["clientDataJSON","authenticatorData","signature"])||exact(r,["clientDataJSON","authenticatorData","signature","userHandle"]))&&
    [r.clientDataJSON,r.authenticatorData,r.signature].every(s=>text(s,8192))&&
    (r.userHandle===undefined||r.userHandle===null||text(r.userHandle,2048));
}

export {
  body as readCommercialJsonBody,
  strictHeaders as inspectCommercialHeaders,
  send as sendCommercialJson,
};
