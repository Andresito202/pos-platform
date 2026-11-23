/**
 * Official institutional website for Camacho POS Colombia.
 * Publication of the site is independent of this constant; the desktop only
 * opens this exact HTTPS origin through the allowlisted shell bridge.
 */
export const INSTITUTIONAL_WEBSITE_URL = "https://camachoposcolombia.com" as const;

/** Exact URLs the desktop may hand to the OS browser. No wildcards. */
export const ALLOWED_EXTERNAL_HTTPS_URLS = [INSTITUTIONAL_WEBSITE_URL] as const;

/**
 * Returns the canonical allowlisted URL, or null when the candidate is not an
 * exact https institutional address (no credentials, query, hash, or path).
 */
export function resolveAllowedExternalHttpsUrl(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  if (path !== "/") return null;
  const normalized = `https://${parsed.hostname.toLowerCase()}`;
  return (ALLOWED_EXTERNAL_HTTPS_URLS as readonly string[]).includes(normalized)
    ? INSTITUTIONAL_WEBSITE_URL
    : null;
}
