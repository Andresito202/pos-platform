import { randomUUID } from "node:crypto";

const CORRELATION = /^[A-Za-z0-9._:-]{8,128}$/;

/** Prefer inbound correlation; otherwise mint a UUID. Never trusts client as authority. */
export function resolveCorrelationId(inbound: string | undefined | null): string {
  if (typeof inbound === "string" && CORRELATION.test(inbound.trim())) return inbound.trim();
  return randomUUID();
}

export function correlationFromHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string {
  const raw = headers["x-correlation-id"] ?? headers["x-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return resolveCorrelationId(value);
}
