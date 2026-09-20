export function canonicalDeviceTrustJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not valid trust payloads");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalDeviceTrustJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalDeviceTrustJson(item)}`).join(",")}}`;
  }
  throw new Error("unsupported trust payload value");
}
