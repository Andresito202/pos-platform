import { describe, expect, it } from "vitest";
import { IpcMessageTypeSchema } from "@pos-platform/contracts";
import { IPC_ALLOWED_CHANNELS } from "../src/ipc-allowlist.js";
import { RENDERER_API_METHODS } from "../src/preload-api.js";

/**
 * Paridad entre lo que el contrato declara y lo que el Desktop puede pedir.
 *
 * ## Qué defecto real fija esta prueba
 *
 * El módulo de crédito (`DEC-005`) quedó **completo en el servicio local**
 * —caso de uso, store, handler, esquema IPC y pruebas— y **inalcanzable desde
 * el producto**: sus cuatro canales nunca se añadieron a la allowlist ni al
 * preload, y `payment.register.qr` tampoco. Cinco operaciones ratificadas por
 * el contrato que el cajero no podía invocar de ninguna forma.
 *
 * Ninguna prueba lo vio, y no por descuido: `ipc-allowlist.test.ts` fija la
 * lista contra **sí misma** y `preload.test.ts` compara el preload con la
 * allowlist. Las dos pasan en verde mientras ambas listas estén igual de
 * incompletas. Faltaba la comparación contra la **única fuente que sabe qué
 * operaciones existen**: `IpcMessageTypeSchema`.
 *
 * ## La exclusión es explícita, no una lista de pendientes
 *
 * Toda operación del contrato debe estar expuesta **salvo** las nombradas
 * abajo, cada una con su razón. Añadir un tipo al contrato sin exponerlo ni
 * excluirlo deliberadamente rompe esta prueba, que es exactamente lo que
 * habría pasado cuando se ratificaron crédito y QR.
 */

/**
 * `runtime.handshake` no se expone y nunca debe exponerse: negocia protocolo
 * entre el proceso principal y el servicio local (`DEC-014` §3.2). El
 * renderer no participa en esa negociación.
 */
const DELIBERATELY_NOT_EXPOSED = new Set<string>(["runtime.handshake"]);

const CONTRACT_MESSAGE_TYPES = IpcMessageTypeSchema.options as readonly string[];

describe("paridad de superficie IPC — contrato ↔ Desktop", () => {
  it("expone toda operación del contrato salvo las excluidas a propósito", () => {
    const expected = CONTRACT_MESSAGE_TYPES
      .filter((type) => !DELIBERATELY_NOT_EXPOSED.has(type))
      .sort();
    expect([...RENDERER_API_METHODS].sort()).toEqual(expected);
  });

  it("cada método del preload tiene su canal allowlisted, y ninguno sobra", () => {
    expect([...IPC_ALLOWED_CHANNELS].sort())
      .toEqual(RENDERER_API_METHODS.map((method) => `pos:${method}`).sort());
  });

  it("no expone nada que el contrato no declare", () => {
    for (const method of RENDERER_API_METHODS) {
      expect(CONTRACT_MESSAGE_TYPES).toContain(method);
    }
  });

  it("el handshake sigue fuera del alcance del renderer", () => {
    // Su ausencia es una decisión, así que se afirma en vez de suponerse.
    expect(CONTRACT_MESSAGE_TYPES).toContain("runtime.handshake");
    expect(RENDERER_API_METHODS as readonly string[]).not.toContain("runtime.handshake");
    expect(IPC_ALLOWED_CHANNELS as readonly string[]).not.toContain("pos:runtime.handshake");
  });

  it("crédito y QR son alcanzables desde el producto", () => {
    // La regresión concreta que motivó este archivo.
    for (const method of [
      "payment.register.qr", "payment.register.credit",
      "credit.account.open", "credit.account.get", "credit.payment.register",
    ]) {
      expect(RENDERER_API_METHODS as readonly string[]).toContain(method);
      expect(IPC_ALLOWED_CHANNELS as readonly string[]).toContain(`pos:${method}`);
    }
  });
});
