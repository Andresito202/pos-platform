import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StructuredLogger } from "@pos-platform/observability";

/**
 * Todo evento que `main.ts` emite tiene que ser uno que `StructuredLogger`
 * acepte.
 *
 * `StructuredLogger.log` lanza con un nombre fuera de `[a-z0-9]` y separadores,
 * y en el arranque esa excepción es `runtime.start_failed`: el servicio no
 * arranca. `security.DEV_ONLY_role_preset_active` llevaba mayúsculas, así que
 * **cualquier arranque con `POS_DEV_ROLE_PRESET` tumbaba el servicio entero**,
 * y ninguna prueba lo vio porque todas llaman a `activateDevRoleSession`
 * directamente, nunca a `main.ts`. Se encontró arrancando `main.ts` de verdad.
 *
 * Se leen los nombres del fuente en vez de enumerarlos a mano: un evento nuevo
 * entra solo. Si la extracción deja de encontrar llamadas, falla en vez de
 * pasar en vacío.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts"), "utf8");
const events = [...source.matchAll(/logger\.log\(\s*[^,]+,\s*"([^"]+)"/g)].map((match) => match[1] as string);

describe("main.ts — nombres de evento del arranque", () => {
  it("la extracción encuentra las llamadas del arranque", () => {
    expect(events.length).toBeGreaterThanOrEqual(15);
    expect(events).toContain("runtime.started");
    expect(events).toContain("security.dev_only_role_preset_active");
    expect(events).toContain("master_data.dev_only_lab_register");
  });

  it.each(events)("StructuredLogger acepta %s", (event) => {
    const logger = new StructuredLogger({ write: () => undefined });
    expect(() => logger.log("info", event)).not.toThrow();
  });
});
