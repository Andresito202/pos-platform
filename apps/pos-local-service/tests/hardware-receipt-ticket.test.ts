import { describe, expect, it } from "vitest";
import {
  encodeText,
  formatScale6,
  ReceiptPrinterProfileSchema,
  renderReceiptTicket,
  wrap,
  type ReceiptPrinterProfile,
} from "../src/hardware/index.js";
import type { Receipt } from "../src/receipts/receipt.js";

const PROFILE: ReceiptPrinterProfile = {
  width_characters: 32,
  code_page: "CP850",
  escpos_code_table: 2,
  cut: "PARTIAL",
  feed_lines_before_cut: 3,
};

const RECEIPT: Receipt = {
  saleId: "018f0000-0000-7000-8000-0000000000c1",
  documentSeries: "POS1",
  saleNumber: 42,
  customerId: null,
  currencyCode: "COP",
  businessDate: "2026-09-26",
  completedAt: "2026-09-26T19:44:50.000Z",
  lines: [
    {
      lineNumber: 1,
      productName: "Chorizo santarrosano artesanal de cerdo y res",
      presentationName: "Paquete x 500 g",
      identifier: "7701234567890",
      unitCode: "UND",
      unitPrecision: 0,
      quantity: "2.000000",
      unitPriceAmount: "12500.000000",
      grossAmount: "25000.000000",
      discountAmount: "0.000000",
      taxableAmount: "25000.000000",
      taxAmount: "0.000000",
      lineTotalAmount: "25000.000000",
    },
    {
      lineNumber: 2,
      productName: "Salchichón",
      presentationName: "Granel",
      identifier: null,
      unitCode: "KG",
      unitPrecision: 3,
      quantity: "1.250000",
      unitPriceAmount: "18000.000000",
      grossAmount: "22500.000000",
      discountAmount: "500.000000",
      taxableAmount: "22000.000000",
      taxAmount: "0.000000",
      lineTotalAmount: "22000.000000",
    },
  ],
  subtotalAmount: "47500.000000",
  discountAmount: "500.000000",
  taxAmount: "0.000000",
  fiscalTotalAmount: "47000.000000",
  commercialRoundingAdjustment: "0.000000",
  payableAmount: "47000.000000",
  payments: [
    {
      paymentMethod: "CASH",
      confirmedAmount: "47000.000000",
      tenderedAmount: "50000.000000",
      changeAmount: "3000.000000",
      currencyCode: "COP",
      confirmedAt: "2026-09-26T19:44:50.000Z",
    },
  ],
  calculationChecksum: "a".repeat(64),
};

/**
 * Separa un trabajo en líneas de texto quitando los comandos que emite
 * `EscPosJob`, para medir lo que de verdad llega al papel.
 */
function paperLines(bytes: Uint8Array): { text: number[][]; commands: string[] } {
  const text: number[][] = [];
  const commands: string[] = [];
  let current: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    if (byte === 0x1b && bytes[i + 1] === 0x40) {
      commands.push("ESC @");
      i += 1;
    } else if (byte === 0x1b || byte === 0x1d) {
      commands.push(`${byte === 0x1b ? "ESC" : "GS"} ${String.fromCharCode(bytes[i + 1]!)} ${String(bytes[i + 2])}`);
      i += 2;
    } else if (byte === 0x0a) {
      text.push(current);
      current = [];
    } else {
      current.push(byte);
    }
  }
  if (current.length > 0) text.push(current);
  return { text, commands };
}

const decode850 = (line: number[]): string => Buffer.from(line).toString("latin1");

describe("formatScale6 — importes sin pérdida", () => {
  it("quita sólo ceros finales y agrupa miles al estilo colombiano", () => {
    expect(formatScale6("12000.000000")).toBe("12.000");
    expect(formatScale6("1.250000")).toBe("1,25");
    expect(formatScale6("1234567.500000")).toBe("1.234.567,5");
    expect(formatScale6("0.000001")).toBe("0,000001");
    expect(formatScale6("-50.000000")).toBe("-50");
  });

  it("rechaza lo que no es escala 6 en vez de adivinar", () => {
    expect(() => formatScale6("12000.5")).toThrow("invalid scale-6");
    expect(() => formatScale6("12000")).toThrow("invalid scale-6");
  });
});

describe("encodeText — página de códigos", () => {
  it("CP850 y CP1252 dan los bytes que dan los códecs de referencia", () => {
    // Valores obtenidos con `"áéíóúñÑ¿¡".encode("cp850"|"cp1252")` en Python.
    expect(encodeText("áéíóúñÑ¿¡", "CP850")).toEqual({ bytes: [0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa8, 0xad], replaced: 0 });
    expect(encodeText("áéíóúñÑ¿¡", "CP1252")).toEqual({ bytes: [0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xf1, 0xd1, 0xbf, 0xa1], replaced: 0 });
  });

  it("normaliza acentos compuestos antes de codificar", () => {
    expect(encodeText("á", "CP850")).toEqual({ bytes: [0xa0], replaced: 0 });
  });

  it("un nombre de producto no puede inyectar un comando ESC/POS", () => {
    // `ESC p 0 25 250` abre el cajón en la mayoría de equipos.
    const hostile = "Queso\u001bp\u0000\u0019ú";
    const encoded = encodeText(hostile, "CP850");
    expect(encoded.bytes).not.toContain(0x1b);
    expect(encoded.bytes).not.toContain(0x00);
    expect(encoded.replaced).toBe(3);
  });

  it("lo que la página no tiene sale como ? y se cuenta", () => {
    expect(encodeText("€", "CP850")).toEqual({ bytes: [0x3f], replaced: 1 });
    expect(encodeText("€", "CP1252")).toEqual({ bytes: [0x80], replaced: 0 });
  });
});

describe("renderReceiptTicket", () => {
  it("empieza inicializando el equipo y seleccionando la tabla del perfil", () => {
    const { bytes } = renderReceiptTicket(RECEIPT, PROFILE, "ORIGINAL");
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
  });

  it("ninguna línea impresa excede el ancho del perfil, tampoco un nombre largo", () => {
    for (const width of [32, 42, 48]) {
      const { bytes } = renderReceiptTicket(RECEIPT, { ...PROFILE, width_characters: width }, "ORIGINAL");
      for (const line of paperLines(bytes).text) expect(line.length).toBeLessThanOrEqual(width);
    }
  });

  it("imprime los importes congelados de la venta, sin recalcular", () => {
    const text = paperLines(renderReceiptTicket(RECEIPT, PROFILE, "ORIGINAL").bytes).text.map(decode850);
    expect(text).toContain(`TOTAL${" ".repeat(32 - "TOTAL".length - "47.000 COP".length)}47.000 COP`);
    expect(text.some((line) => line.endsWith("-500"))).toBe(true);
    expect(text.some((line) => line.startsWith("  Cambio") && line.endsWith("3.000"))).toBe(true);
    expect(text.some((line) => line.includes("1,25 KG x 18.000"))).toBe(true);
    // Redondeo en cero no se imprime; no es un dato, es ruido.
    expect(text.some((line) => line.startsWith("Redondeo"))).toBe(false);
  });

  it("imprime el ajuste de redondeo cuando existe", () => {
    const rounded = { ...RECEIPT, commercialRoundingAdjustment: "-20.000000", payableAmount: "46980.000000" };
    const text = paperLines(renderReceiptTicket(rounded, PROFILE, "ORIGINAL").bytes).text.map(decode850);
    expect(text.some((line) => line.startsWith("Redondeo") && line.endsWith("-20"))).toBe(true);
  });

  it("una reimpresión lo dice; el original no", () => {
    const reprint = paperLines(renderReceiptTicket(RECEIPT, PROFILE, "REPRINT").bytes).text;
    const original = paperLines(renderReceiptTicket(RECEIPT, PROFILE, "ORIGINAL").bytes).text;
    const marker = encodeText("*** REIMPRESIÓN ***", "CP850").bytes;
    expect(reprint).toContainEqual(marker);
    expect(original).not.toContainEqual(marker);
  });

  it("corta sólo si el perfil declara la capacidad, tras el avance configurado", () => {
    const partial = renderReceiptTicket(RECEIPT, PROFILE, "ORIGINAL").bytes;
    expect([...partial.slice(-6)]).toEqual([0x1b, 0x64, 3, 0x1d, 0x56, 1]);
    const full = renderReceiptTicket(RECEIPT, { ...PROFILE, cut: "FULL" }, "ORIGINAL").bytes;
    expect([...full.slice(-3)]).toEqual([0x1d, 0x56, 0]);
    const none = paperLines(renderReceiptTicket(RECEIPT, { ...PROFILE, cut: "NONE" }, "ORIGINAL").bytes).commands;
    expect(none.some((command) => command.startsWith("GS V"))).toBe(false);
  });

  it("es determinista: la misma venta produce los mismos bytes", () => {
    const first = renderReceiptTicket(RECEIPT, PROFILE, "REPRINT").bytes;
    const second = renderReceiptTicket(RECEIPT, PROFILE, "REPRINT").bytes;
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it("no inventa cabecera fiscal (DEC-019)", () => {
    const text = paperLines(renderReceiptTicket(RECEIPT, PROFILE, "ORIGINAL").bytes).text.map(decode850).join("\n");
    expect(text).not.toMatch(/NIT|CUFE|raz[oó]n social/i);
  });
});

describe("wrap y perfil", () => {
  it("parte a la fuerza una palabra más larga que la línea", () => {
    expect(wrap("abcdefghij kl", 4)).toEqual(["abcd", "efgh", "ij", "kl"]);
  });

  it("el perfil rechaza anchos imposibles y páginas no soportadas", () => {
    expect(ReceiptPrinterProfileSchema.safeParse({ ...PROFILE, width_characters: 20 }).success).toBe(false);
    expect(ReceiptPrinterProfileSchema.safeParse({ ...PROFILE, code_page: "UTF8" }).success).toBe(false);
    expect(ReceiptPrinterProfileSchema.safeParse(PROFILE).success).toBe(true);
  });
});
