/**
 * Optional, non-authoritative desktop hints exposed by preload.
 * Never used for permission grants — only for UX convenience such as
 * prefilling the design-review cash register UUID already provisioned locally.
 */
export type PosDesktopHints = {
  readonly designReviewRegisterId: string | null;
};

declare global {
  interface Window {
    posDesktopHints?: PosDesktopHints;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readDesignReviewRegisterId(): string | null {
  const value = window.posDesktopHints?.designReviewRegisterId ?? null;
  if (value === null || value.trim() === "") return null;
  const trimmed = value.trim().toLowerCase();
  return UUID.test(trimmed) ? trimmed : null;
}
