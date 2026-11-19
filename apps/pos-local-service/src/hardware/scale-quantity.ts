/** Convert the observed integer grams using the catalog unit; never round a sale quantity. */
export function scaleQuantity(grams: number, unit: string, precision: number): string | null {
  if (!Number.isSafeInteger(grams) || grams < 100 || grams > 40000 || grams % 5 !== 0 ||
      !Number.isInteger(precision) || precision < 0 || precision > 6) return null;
  const scaled = unit === "KGM" ? grams * 1000 : unit === "GRM" ? grams * 1000000 : null;
  if (scaled === null || scaled % (10 ** (6 - precision)) !== 0) return null;
  return String(Math.floor(scaled / 1000000)) + "." + String(scaled % 1000000).padStart(6,"0");
}
