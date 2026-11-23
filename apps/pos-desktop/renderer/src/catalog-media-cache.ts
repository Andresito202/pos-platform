import type { CatalogMediaGetResult } from "@pos-platform/contracts";
import { callCommercial } from "./pos-service.js";

/**
 * Session cache of verified catalog media object URLs.
 * Bytes come only from `catalog.media.get` (tenant/company scoped); never from
 * arbitrary paths or remote URLs. List/find responses carry media_id only.
 */
const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function peekCatalogMediaUrl(mediaId: string): string | null {
  return memory.get(mediaId) ?? null;
}

export function forgetCatalogMedia(mediaId: string): void {
  const url = memory.get(mediaId);
  if (url !== undefined) {
    URL.revokeObjectURL(url);
    memory.delete(mediaId);
  }
  inflight.delete(mediaId);
}

export async function resolveCatalogMediaUrl(mediaId: string): Promise<string | null> {
  const cached = memory.get(mediaId);
  if (cached !== undefined) return cached;

  const pending = inflight.get(mediaId);
  if (pending !== undefined) return pending;

  const load = (async (): Promise<string | null> => {
    try {
      const response = await callCommercial<CatalogMediaGetResult>(
        "catalog.media.get",
        { media_id: mediaId },
      );
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
      memory.set(mediaId, url);
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
