/**
 * Validates catalog card images without inventing an image-processing dependency.
 * Admin UI must resize to card bounds before upload; the service verifies magic,
 * size and dimensions and refuses arbitrary paths/URLs.
 */

export const CATALOG_MEDIA_MAX_BYTES = 262_144;
export const CATALOG_MEDIA_MIN_EDGE = 32;
export const CATALOG_MEDIA_MAX_EDGE = 512;

export type CatalogMediaMime = "image/jpeg" | "image/png" | "image/webp";

export type CatalogMediaValidation =
  | {
      readonly ok: true;
      readonly mime: CatalogMediaMime;
      readonly width: number;
      readonly height: number;
    }
  | { readonly ok: false; readonly reason: string };

function hasPngIend(buffer: Buffer): boolean {
  // Trailer must be present — truncated PNGs with only IHDR are refused.
  for (let offset = 8; offset + 12 <= buffer.length; offset += 1) {
    if (buffer.subarray(offset + 4, offset + 8).toString("ascii") === "IEND") return true;
  }
  return false;
}

function inspectPng(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  if (!hasPngIend(buffer)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function inspectJpeg(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  let size: { width: number; height: number } | null = null;
  let sawEoi = false;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1]!;
    if (marker === 0xd9) {
      sawEoi = true;
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && offset + 9 < buffer.length) {
      size = {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  if (!sawEoi || size === null) return null;
  return size;
}

function inspectWebp(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF") return null;
  if (buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && buffer.length >= 30) {
    const width = 1 + buffer[24]! + (buffer[25]! << 8) + (buffer[26]! << 16);
    const height = 1 + buffer[27]! + (buffer[28]! << 8) + (buffer[29]! << 16);
    return { width, height };
  }
  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function validateCatalogMediaBytes(buffer: Buffer): CatalogMediaValidation {
  if (buffer.length === 0 || buffer.length > CATALOG_MEDIA_MAX_BYTES) {
    return { ok: false, reason: "IMAGE_SIZE_INVALID" };
  }

  let mime: CatalogMediaMime | null = null;
  let size: { width: number; height: number } | null = null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    mime = "image/jpeg";
    size = inspectJpeg(buffer);
  } else if (buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    mime = "image/png";
    size = inspectPng(buffer);
  } else if (buffer.subarray(0, 4).toString("ascii") === "RIFF") {
    mime = "image/webp";
    size = inspectWebp(buffer);
  } else {
    return { ok: false, reason: "IMAGE_TYPE_INVALID" };
  }

  if (size === null) return { ok: false, reason: "IMAGE_DIMENSIONS_UNREADABLE" };
  if (
    size.width < CATALOG_MEDIA_MIN_EDGE
    || size.height < CATALOG_MEDIA_MIN_EDGE
    || size.width > CATALOG_MEDIA_MAX_EDGE
    || size.height > CATALOG_MEDIA_MAX_EDGE
  ) {
    return { ok: false, reason: "IMAGE_DIMENSIONS_OUT_OF_RANGE" };
  }

  return { ok: true, mime, width: size.width, height: size.height };
}
