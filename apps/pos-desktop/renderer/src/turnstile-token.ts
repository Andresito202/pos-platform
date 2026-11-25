/** Same-origin Turnstile token for public web login. No offline/cajero use. */
type TurnstileApi = {
  render: (el: HTMLElement, options: {
    sitekey: string;
    size: "invisible";
    callback: (token: string) => void;
    "error-callback"?: () => void;
    "expired-callback"?: () => void;
  }) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(Error("Turnstile no disponible."));
      }, { once: true });
      existing.addEventListener("error", () => reject(Error("Turnstile no cargó.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(Error("Turnstile no disponible."));
    }, { once: true });
    script.addEventListener("error", () => reject(Error("Turnstile no cargó.")), { once: true });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Invisible widget; host page CSP must allow challenges.cloudflare.com when enabled. */
export async function acquireTurnstileToken(siteKey: string, signal?: AbortSignal): Promise<string> {
  if (!siteKey || siteKey.length < 10) throw Error("Turnstile site key inválida.");
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const api = await loadTurnstile();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;clip:rect(0,0,0,0)";
  document.body.appendChild(host);
  return await new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      if (widgetId !== null) {
        try { api.remove(widgetId); } catch { /* ignore */ }
      }
      host.remove();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      widgetId = api.render(host, {
        sitekey: siteKey,
        size: "invisible",
        callback: (token) => { cleanup(); resolve(token); },
        "error-callback": () => { cleanup(); reject(Error("Turnstile rechazado.")); },
        "expired-callback": () => { cleanup(); reject(Error("Turnstile expiró.")); },
      });
      api.execute(widgetId);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : Error("Turnstile falló."));
    }
  });
}
