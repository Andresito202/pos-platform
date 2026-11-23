/**
 * Client-side card optimization before `catalog.media.put`.
 * The Local Service validates magic bytes, size and dimensions; it does not
 * accept arbitrary paths/URLs or invent an image-processing dependency.
 */

export const CATALOG_CARD_EDGE = 256;
export const CATALOG_CARD_MAX_BYTES = 240_000;

export type CatalogCardImage =
  | { readonly ok: true; readonly contentBase64: string; readonly mimeType: "image/jpeg" | "image/png" }
  | { readonly ok: false; readonly reason: string };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(new Error("IMAGE_READ_FAILED")); };
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("IMAGE_READ_FAILED"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { resolve(image); };
    image.onerror = () => { reject(new Error("IMAGE_DECODE_FAILED")); };
    image.src = dataUrl;
  });
}

export async function prepareCatalogCardImage(file: File): Promise<CatalogCardImage> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, reason: "IMAGE_TYPE_INVALID" };
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);
    if (image.naturalWidth < 32 || image.naturalHeight < 32) {
      return { ok: false, reason: "IMAGE_DIMENSIONS_OUT_OF_RANGE" };
    }
    const scale = Math.min(
      1,
      CATALOG_CARD_EDGE / image.naturalWidth,
      CATALOG_CARD_EDGE / image.naturalHeight,
    );
    const width = Math.max(32, Math.round(image.naturalWidth * scale));
    const height = Math.max(32, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return { ok: false, reason: "IMAGE_CANVAS_UNAVAILABLE" };
    context.drawImage(image, 0, 0, width, height);

    const preferPng = file.type === "image/png";
    const mimeType = preferPng ? "image/png" : "image/jpeg";
    const quality = preferPng ? undefined : 0.82;
    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((value) => { resolve(value); }, mimeType, quality);
    });
    if (blob === null) return { ok: false, reason: "IMAGE_ENCODE_FAILED" };
    if (blob.size > CATALOG_CARD_MAX_BYTES) {
      return { ok: false, reason: "IMAGE_SIZE_INVALID" };
    }
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of buffer) binary += String.fromCharCode(byte);
    return {
      ok: true,
      contentBase64: btoa(binary),
      mimeType,
    };
  } catch {
    return { ok: false, reason: "IMAGE_PREPARE_FAILED" };
  }
}
