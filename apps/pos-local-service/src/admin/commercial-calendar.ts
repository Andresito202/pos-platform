/** Colombia POS commercial calendar until branch timezone is provisioned. */
export const COMMERCIAL_TIMEZONE = "America/Bogota" as const;

/** YYYY-MM-DD in the commercial timezone for the provided instant. */
export function commercialBusinessDate(at: Date, timeZone: string = COMMERCIAL_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
