/**
 * Cloudflare Turnstile server-side verification for public GLOBAL/BUSINESS web login.
 * Must not be wired into local offline cajero / Electron IPC.
 */
export type TurnstileVerifyInput = {
  readonly secret: string;
  readonly token: string;
  readonly remoteip?: string;
  readonly fetchImpl?: typeof fetch;
};

export async function verifyTurnstileToken(input: TurnstileVerifyInput): Promise<boolean> {
  if (typeof input.secret !== "string" || input.secret.length < 16 || input.secret.length > 256) return false;
  if (typeof input.token !== "string" || input.token.length < 1 || input.token.length > 2048) return false;
  if (input.remoteip !== undefined && (typeof input.remoteip !== "string" || input.remoteip.length > 256)) return false;
  const body = new URLSearchParams({ secret: input.secret, response: input.token });
  if (input.remoteip) body.set("remoteip", input.remoteip);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return false;
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return false;
    const json = await res.json() as { success?: unknown };
    return json.success === true;
  } catch {
    return false;
  }
}
