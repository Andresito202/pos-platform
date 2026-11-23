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
  readonly bytes: number;
};

let activeScopeKey = "anonymous:0";
// Keep renderer memory finite. Entries are LRU; images larger than this limit
// are rejected rather than creating untracked blob: URLs.
const MAX_MEDIA_ENTRIES = 256;
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
let cachedBytes = 0;
let cacheGeneration = 0;
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

function removeEntry(mediaId: string): void {
  const entry = memory.get(mediaId);
  if (entry === undefined) return;
  URL.revokeObjectURL(entry.url);
  cachedBytes -= entry.bytes;
  memory.delete(mediaId);
}

function scopeKeyOf(scope: CatalogMediaSessionScope): string {
  return `${scope.username ?? ""}:${scope.role ?? ""}:${scope.epoch}`;
}

function revokeAll(): void {
  cacheGeneration += 1;
  for (const id of memory.keys()) removeEntry(id);
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
    removeEntry(mediaId);
    return null;
  }
  // Refresh LRU order without allocating a second blob URL.
  memory.delete(mediaId);
  memory.set(mediaId, entry);
  return entry.url;
}

export function forgetCatalogMedia(mediaId: string): void {
  removeEntry(mediaId);
  inflight.delete(mediaId);
}

export async function resolveCatalogMediaUrl(mediaId: string): Promise<string | null> {
  const cached = peekCatalogMediaUrl(mediaId);
  if (cached !== null) return cached;

  const pending = inflight.get(mediaId);
  if (pending !== undefined) return pending;

  const loadScope = activeScopeKey;
  const loadGeneration = cacheGeneration;
  const load = (async (): Promise<string | null> => {
    try {
      const response = await callCommercial<CatalogMediaGetResult>(
        "catalog.media.get",
        { media_id: mediaId },
      );
      if (loadScope !== activeScopeKey || loadGeneration !== cacheGeneration || inflight.get(mediaId) !== load) return null;
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
      if (binary.byteLength > MAX_MEDIA_BYTES) return null;
      const blob = new Blob([binary], { type: response.result.mime_type });
      if (loadScope !== activeScopeKey || loadGeneration !== cacheGeneration || inflight.get(mediaId) !== load) return null;
      const previous = memory.get(mediaId);
      if (previous !== undefined) removeEntry(mediaId);
      while (memory.size >= MAX_MEDIA_ENTRIES || cachedBytes + binary.byteLength > MAX_MEDIA_BYTES) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        removeEntry(oldest);
      }
      const url = URL.createObjectURL(blob);
      memory.set(mediaId, { scopeKey: loadScope, url, bytes: binary.byteLength });
      cachedBytes += binary.byteLength;
      return url;
    } catch {
      return null;
    } finally {
      // An invalidated request must not erase a newer request for this media.
      if (inflight.get(mediaId) === load) inflight.delete(mediaId);
    }
  })();

  inflight.set(mediaId, load);
  return load;
}
