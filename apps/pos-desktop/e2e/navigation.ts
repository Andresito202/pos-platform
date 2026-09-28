import type { Page } from "@playwright/test";

/**
 * Lleva la ventana a la sección del menú lateral que contiene `testId`, como
 * haría una persona antes de tocar ese control.
 *
 * Desde el 2026-09-28 los 13 paneles se reparten en secciones y las que no
 * están activas llevan `hidden` (`renderer/src/App.tsx`). Playwright no
 * escribe en un campo oculto ni lo da por visible, así que cada acción de
 * estas pruebas pasa antes por aquí. El recorrido es el mismo que el de un
 * operador: pulsar la sección en el menú, no forzar nada por detrás.
 *
 * Si el elemento todavía no existe —un resultado que aparece tras una
 * operación— espera a que se adjunte; si nunca llega, no navega y deja que la
 * aserción de la prueba falle con su propio mensaje. Lo que vive fuera de toda
 * sección (el estado del servicio, en el menú) no necesita navegación.
 */
export async function showSectionOf(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId).first();
  try {
    await target.waitFor({ state: "attached", timeout: 30_000 });
  } catch {
    return;
  }
  const section = await target.evaluate(
    (node) => node.closest("[data-nav-section]")?.getAttribute("data-nav-section") ?? null,
  );
  if (section === null) return;
  const item = page.locator(`[data-nav-target="${section}"]`);
  if ((await item.getAttribute("aria-current")) !== "page") await item.click();
}
