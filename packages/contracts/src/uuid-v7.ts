/**
 * Generates an RFC 9562 UUIDv7 using the platform Web Crypto API.
 *
 * Kept browser-safe so contracts can be consumed by Electron/React as well as
 * the local service without introducing a Node-only dependency into the
 * contracts package.
 */
export function uuidV7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
