import type { Receipt } from "../../receipts/receipt.js";
import { EscPosJob } from "./escpos.js";
import type { ReceiptPrinterProfile } from "./print-profile.js";

/**
 * El recibo en papel. Es otra **presentación** de la misma proyección que ve
 * el cajero en pantalla (`DEC-019`), no un documento aparte: no calcula,
 * no suma y no agrega nada que la venta no tenga congelado.
 *
 * Lo que no lleva, a propósito y por las mismas razones que `DEC-019`: ni
 * razón social ni NIT —no hay identidad de compañía en local y fabricarla en
 * un papel que se entrega a un cliente es un problema legal— ni CUFE ni QR.
 */

/**
 * Importe o cantidad de escala 6 a texto colombiano, **sin pérdida**: se
 * quitan sólo los ceros finales de la fracción, nunca un dígito significativo.
 * `"12000.000000"` → `"12.000"`, `"1.250000"` → `"1,25"`. Redondear aquí
 * produciría en papel una cifra distinta a la cobrada.
 */
export function formatScale6(value: string): string {
  const match = /^(-?)(\d+)\.(\d{6})$/.exec(value);
  if (match === null) throw new Error(`invalid scale-6 amount: ${value}`);
  const [, sign, integer, fraction] = match as unknown as [string, string, string, string];
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const significant = fraction.replace(/0+$/, "");
  return `${sign}${grouped}${significant === "" ? "" : `,${significant}`}`;
}

const isZero = (value: string): boolean => /^-?0+\.0{6}$/.test(value);

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  QR: "QR",
  CUSTOMER_CREDIT: "Crédito",
};

/** Corta en palabras; una palabra más larga que la línea se parte a la fuerza. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    let rest = word;
    while (rest.length > width) {
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (current === "") current = rest;
    else if (current.length + 1 + rest.length <= width) current = `${current} ${rest}`;
    else {
      lines.push(current);
      current = rest;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Etiqueta a la izquierda, valor a la derecha; si no caben juntos, el valor baja. */
export function columns(label: string, value: string, width: number): string[] {
  if (label.length + 1 + value.length <= width) {
    return [`${label}${" ".repeat(width - label.length - value.length)}${value}`];
  }
  return [...wrap(label, width), value.padStart(width)];
}

export type ReceiptCopy = "ORIGINAL" | "REPRINT";

export function renderReceiptTicket(
  receipt: Receipt,
  profile: ReceiptPrinterProfile,
  copy: ReceiptCopy,
): { bytes: Uint8Array; replacedCharacters: number } {
  const job = new EscPosJob(profile);
  const width = job.width;
  const rows = (lines: string[]): void => { for (const line of lines) job.line(line); };
  const rule = "-".repeat(width);

  job.align("CENTER");
  // Una copia que no diga que es copia puede presentarse como un segundo
  // comprobante de la misma venta.
  if (copy === "REPRINT") job.bold(true).line("*** REIMPRESIÓN ***").bold(false);
  job.bold(true).line("RECIBO DE VENTA").bold(false);
  job.line(`${receipt.documentSeries}-${String(receipt.saleNumber)}`);
  job.align("LEFT");
  rows(columns("Fecha", receipt.businessDate, width));
  rows(columns("Cobrada", receipt.completedAt, width));
  job.line(rule);

  for (const line of receipt.lines) {
    rows(wrap(`${line.productName} ${line.presentationName}`, width));
    const detail = `  ${formatScale6(line.quantity)} ${line.unitCode} x ${formatScale6(line.unitPriceAmount)}`;
    rows(columns(detail, formatScale6(line.lineTotalAmount), width));
    if (!isZero(line.discountAmount)) {
      rows(columns("  Descuento", `-${formatScale6(line.discountAmount)}`, width));
    }
  }

  job.line(rule);
  rows(columns("Subtotal", formatScale6(receipt.subtotalAmount), width));
  if (!isZero(receipt.discountAmount)) rows(columns("Descuento", `-${formatScale6(receipt.discountAmount)}`, width));
  rows(columns("Impuestos", formatScale6(receipt.taxAmount), width));
  // El ajuste de redondeo se imprime en vez de absorberse, igual que en
  // pantalla: es la diferencia entre lo que suman las líneas y lo cobrado.
  if (!isZero(receipt.commercialRoundingAdjustment)) {
    rows(columns("Redondeo", formatScale6(receipt.commercialRoundingAdjustment), width));
  }
  job.bold(true).doubleHeight(true);
  rows(columns("TOTAL", `${formatScale6(receipt.payableAmount)} ${receipt.currencyCode}`, width));
  job.doubleHeight(false).bold(false);
  job.line(rule);

  for (const payment of receipt.payments) {
    rows(columns(PAYMENT_LABELS[payment.paymentMethod] ?? payment.paymentMethod, formatScale6(payment.confirmedAmount), width));
    if (payment.tenderedAmount !== null) rows(columns("  Recibido", formatScale6(payment.tenderedAmount), width));
    if (payment.changeAmount !== null) rows(columns("  Cambio", formatScale6(payment.changeAmount), width));
  }

  job.line(rule);
  job.align("CENTER");
  // Prefijo de la huella del cálculo: dos papeles con el mismo valor dicen
  // lo mismo, y permite cotejar una reimpresión con la venta.
  job.line(`Verif. ${receipt.calculationChecksum.slice(0, 16)}`);
  job.align("LEFT");
  return job.finish();
}
