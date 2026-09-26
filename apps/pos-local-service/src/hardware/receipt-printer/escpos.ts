import type { ReceiptPrinterProfile } from "./print-profile.js";

/**
 * Mitad alta (0x80–0xFF) de cada página de códigos, generada desde los códecs
 * `cp850` y `cp1252` de Python y fijada aquí para no depender de una tabla de
 * terceros. `U+FFFD` marca las cinco posiciones que CP1252 no define.
 */
const UPPER_HALF: Record<ReceiptPrinterProfile["code_page"], string> = {
  CP850:
    "ÇüéâäàåçêëèïîìÄÅ"
    + "ÉæÆôöòûùÿÖÜø£Ø×ƒ"
    + "áíóúñÑªº¿®¬½¼¡«»"
    + "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐"
    + "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤"
    + "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀"
    + "ÓßÔÒõÕµþÞÚÛÙýÝ¯´"
    + "­±‗¾¶§÷¸°¨·¹³²■ ",
  CP1252:
    "€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž�"
    + "�‘’“”•–—˜™š›œ�žŸ"
    + " ¡¢£¤¥¦§¨©ª«¬­®¯"
    + "°±²³´µ¶·¸¹º»¼½¾¿"
    + "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏ"
    + "ÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß"
    + "àáâãäåæçèéêëìíîï"
    + "ðñòóôõö÷øùúûüýþÿ",
};

const ENCODERS = new Map(
  (Object.keys(UPPER_HALF) as ReceiptPrinterProfile["code_page"][]).map((page) => {
    const table = new Map<string, number>();
    [...UPPER_HALF[page]].forEach((character, index) => {
      if (character !== "�") table.set(character, 0x80 + index);
    });
    return [page, table] as const;
  }),
);

const REPLACEMENT = 0x3f; // "?"

/**
 * Texto a bytes de la página del perfil. Todo lo que la página no tiene sale
 * como `?` **y se cuenta**: un ticket con un nombre mal impreso es un defecto
 * visible, y el contador permite reportarlo en vez de descubrirlo en papel.
 * Los caracteres de control nunca pasan: un nombre de producto no puede
 * inyectar un comando ESC/POS (abrir el cajón, por ejemplo).
 */
export function encodeText(text: string, page: ReceiptPrinterProfile["code_page"]): { bytes: number[]; replaced: number } {
  const table = ENCODERS.get(page)!;
  const bytes: number[] = [];
  let replaced = 0;
  for (const character of text.normalize("NFC")) {
    const code = character.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) {
      bytes.push(code);
      continue;
    }
    const mapped = table.get(character);
    if (mapped === undefined) {
      bytes.push(REPLACEMENT);
      replaced += 1;
    } else {
      bytes.push(mapped);
    }
  }
  return { bytes, replaced };
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Alignment = "LEFT" | "CENTER" | "RIGHT";

/**
 * Constructor de un trabajo ESC/POS. Sólo emite los comandos que este
 * proyecto usa, cada uno con su secuencia literal del conjunto ESC/POS:
 * `ESC @` iniciar, `ESC t n` tabla de caracteres, `ESC a n` alineación,
 * `ESC E n` negrita, `GS ! n` tamaño, `ESC d n` avance y `GS V m` corte.
 */
export class EscPosJob {
  private readonly bytes: number[] = [];
  private replacedCharacters = 0;

  constructor(private readonly profile: ReceiptPrinterProfile) {
    this.bytes.push(ESC, 0x40, ESC, 0x74, profile.escpos_code_table);
  }

  get width(): number {
    return this.profile.width_characters;
  }

  align(alignment: Alignment): this {
    this.bytes.push(ESC, 0x61, alignment === "LEFT" ? 0 : alignment === "CENTER" ? 1 : 2);
    return this;
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** Doble alto sin doble ancho: conserva los caracteres por línea del perfil. */
  doubleHeight(on: boolean): this {
    this.bytes.push(GS, 0x21, on ? 0x01 : 0x00);
    return this;
  }

  line(text = ""): this {
    const encoded = encodeText(text, this.profile.code_page);
    this.bytes.push(...encoded.bytes, LF);
    this.replacedCharacters += encoded.replaced;
    return this;
  }

  /** Cierra el trabajo: avance y corte sólo si el perfil declara la capacidad. */
  finish(): { bytes: Uint8Array; replacedCharacters: number } {
    if (this.profile.feed_lines_before_cut > 0) {
      this.bytes.push(ESC, 0x64, this.profile.feed_lines_before_cut);
    }
    if (this.profile.cut !== "NONE") {
      this.bytes.push(GS, 0x56, this.profile.cut === "FULL" ? 0 : 1);
    }
    return { bytes: Uint8Array.from(this.bytes), replacedCharacters: this.replacedCharacters };
  }
}
