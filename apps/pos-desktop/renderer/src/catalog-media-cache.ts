import type { CatalogMediaGetResult } from "@pos-platform/contracts";
import { callCommercial } from "./pos-service.js";

/**
 * Session-bound cache of verified catalog media object URLs.
 * Bytes come only from `catalog.media.get` (tenant/company scoped); never from
 * arbitrary paths or remote URLs. List/find responses carry media_id only.
 *
 * A photograph loaded under one operator/session must not survive logout,
 * user switch, or access revocation. Authorization is re-checked on every miss
 * via catalog.media.get — the cache is not a grant.
 */

export type CatalogMediaSessionScope = {
  readonly username: string | null;
  readonly role: string | null;
  readonly epoch: number;
};

type CacheEntry = {
  readonly scopeKey: string;
  readonly url: string;
};

let activeScopeKey = "anonymous:0";
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

function scopeKeyOf(scope: CatalogMediaSessionScope): string {
  return `${scope.username ?? ""}:${scope.role ?? ""}:${scope.epoch}`;
}

function revokeAll(): void {
  for (const entry of memory.values()) {
    URL.revokeObjectURL(entry.url);
  }
  memory.clear();
  inflight.clear();
}

/** Bind cache to the current local operator session. Wipes prior session media. */
export function bindCatalogMediaSession(scope: CatalogMediaSessionScope): void {
  const next = scopeKeyOf(scope);
  if (next === activeScopeKey) return;
  revokeAll();
  activeScopeKey = next;
}

/** Full wipe — logout, denial, expiry, or explicit revoke. */
export function clearCatalogMediaCache(): void {
  revokeAll();
  activeScopeKey = `cleared:${Date.now()}`;
}

export function peekCatalogMediaUrl(mediaId: string): string | null {
  const entry = memory.get(mediaId);
  if (entry === undefined) return null;
  if (entry.scopeKey !== activeScopeKey) {
    URL.revokeObjectURL(entry.url);
    memory.delete(mediaId);
    return null;
  }
  return entry.url;
}

export function forgetCatalogMedia(mediaId: string): void {
  const entry = memory.get(mediaId);
  if (entry !== undefined) {
    URL.revokeObjectURL(entry.url);
    memory.delete(mediaId);
  }
  inflight.delete(mediaId);
}

export async function resolveCatalogMediaUrl(mediaId: string): Promise<string | null> {
  const cached = peekCatalogMediaUrl(mediaId);
  if (cached !== null) return cached;

  const pending = inflight.get(mediaId);
  if (pending !== undefined) return pending;

  const loadScope = activeScopeKey;
  const load = (async (): Promise<string | null> => {
    try {
      const response = await callCommercial<CatalogMediaGetResult>(
        "catalog.media.get",
        { media_id: mediaId },
      );
      if (loadScope !== activeScopeKey) return null;
      if (
        response.status !== "SUCCEEDED"
        || response.result === null
        || response.result.outcome !== "FOUND"
        || response.result.content_base64 === null
        || response.result.mime_type === null
      ) {
        return null;
      }
      const binary = Uint8Array.from(atob(response.result.content_base64), (c) => c.charCodeAt(0));
      const blob = new Blob([binary], { type: response.result.mime_type });
      const url = URL.createObjectURL(blob);
      if (loadScope !== activeScopeKey) {
        URL.revokeObjectURL(url);
        return null;
      }
      const previous = memory.get(mediaId);
      if (previous !== undefined) URL.revokeObjectURL(previous.url);
      memory.set(mediaId, { scopeKey: loadScope, url });
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(mediaId);
    }
  })();

  inflight.set(mediaId, load);
  return load;
}
