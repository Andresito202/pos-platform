import { BrowserWindow } from "electron";
import { WINDOW_SECURITY_CONFIG } from "./window-security.js";

/**
 * Sentinel de retorno que este manejador reconoce.
 *
 * No resuelve a nada real: la interceptación ocurre en `will-navigate`/
 * `will-redirect`, **antes** de que la navegación llegue a comprometerse, así
 * que nunca se hace la petición de red real contra este dominio. Existe para
 * que este archivo y quien aprovisione
 * `WompiCheckoutCredentials.redirectUrl` del lado del servicio local
 * (`apps/pos-local-service/src/payments/wompi/wompi-checkout-builder.ts`)
 * acuerden exactamente el mismo valor — ver `DEC-016` §20.6. Ese
 * aprovisionamiento sigue sin hacerse; hasta que lo esté, este valor es
 * provisional.
 */
export const WOMPI_CHECKOUT_RETURN_URL = "https://payments.camacho.internal/wompi/return";

export interface QrCheckoutOpenRequest {
  readonly paymentId: string;
  readonly checkoutUrl: string;
}

export type QrCheckoutResult =
  | { readonly outcome: "REDIRECTED"; readonly paymentId: string; readonly providerTransactionId: string }
  | { readonly outcome: "CLOSED_BY_USER"; readonly paymentId: string }
  | { readonly outcome: "REDIRECT_MISSING_TRANSACTION_ID"; readonly paymentId: string }
  | { readonly outcome: "INVALID_CHECKOUT_URL"; readonly paymentId: string };

/**
 * `navigatedUrl` coincide con el retorno cuando el origen **y** la ruta son
 * exactamente iguales — nunca una comparación de subcadena, que un checkout
 * controlado por Wompi (o cualquier navegación intermedia del flujo real:
 * banco, 3DS) podría producir por coincidencia.
 */
export function matchesReturnUrl(navigatedUrl: string, returnUrl: string = WOMPI_CHECKOUT_RETURN_URL): boolean {
  try {
    const navigated = new URL(navigatedUrl);
    const target = new URL(returnUrl);
    return navigated.origin === target.origin && navigated.pathname === target.pathname;
  } catch {
    return false;
  }
}

/** `id` es el único parámetro que Wompi documenta en el redirect de retorno. */
export function extractTransactionId(navigatedUrl: string): string | null {
  try {
    const id = new URL(navigatedUrl).searchParams.get("id");
    return id !== null && id.trim() !== "" ? id : null;
  } catch {
    return null;
  }
}

function isWellFormedUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

interface NavigationEvent {
  preventDefault(): void;
}

/**
 * Abre el checkout de Wompi en una ventana propia y captura el redirect de
 * retorno — `DEC-016` §20.
 *
 * ## Por qué una ventana separada, no la ventana principal
 *
 * La ventana principal nunca navega a contenido ajeno: `window-security.ts`
 * la endurece asumiendo que sólo carga el renderer propio. Esta ventana **sí**
 * navega a Wompi y a lo que el flujo de pago necesite (banco, 3DS), así que
 * lleva el mismo `WINDOW_SECURITY_CONFIG.webPreferences` pero **sin
 * preload**: nunca debe tener acceso a `posService` ni a ninguna API del
 * proceso principal — es una ventana de navegador corriente mostrando la
 * página de Wompi, nada más.
 *
 * ## Por qué `will-navigate` + `will-redirect`, no `did-navigate`
 *
 * Ambos son cancelables y disparan **antes** de que la navegación se
 * comprometa: `will-redirect` para una respuesta HTTP 3xx, `will-navigate`
 * para cualquier otra navegación del frame superior (incluida
 * `location.href` desde JavaScript). Entre los dos cubren las dos formas
 * reales de redirect sin depender de `did-navigate`, que dispara **después**
 * de que la página ya cargó — deja de ser cancelable y produce un parpadeo
 * evitable.
 *
 * ## Por qué el redirect nunca es la autoridad
 *
 * Wompi documenta su propio redirect como "informativo únicamente, nunca un
 * método de validación" — `DEC-016` §6 regla 5 exige lo mismo para toda
 * entrada no confiable. Este manejador **sólo extrae un id de transacción**;
 * la decisión real sigue viviendo en `ReconcileProviderPaymentUseCase`, que
 * consulta a Wompi directamente antes de confirmar nada.
 */
export class QrCheckoutWindowManager {
  constructor(private readonly returnUrl: string = WOMPI_CHECKOUT_RETURN_URL) {}

  openCheckout(request: QrCheckoutOpenRequest, parent?: BrowserWindow): Promise<QrCheckoutResult> {
    if (!isWellFormedUrl(request.checkoutUrl)) {
      return Promise.resolve({ outcome: "INVALID_CHECKOUT_URL", paymentId: request.paymentId });
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: QrCheckoutResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const checkoutWindow = new BrowserWindow({
        width: 480,
        height: 760,
        show: true,
        modal: parent !== undefined,
        ...(parent === undefined ? {} : { parent }),
        webPreferences: { ...WINDOW_SECURITY_CONFIG.webPreferences },
      });

      // El checkout no abre popups propios: cualquier sub-flujo (banco, 3DS)
      // navega dentro de esta misma ventana, que es la única que este
      // manejador observa.
      checkoutWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

      const handleNavigation = (event: NavigationEvent, url: string): void => {
        if (settled) return;
        if (!matchesReturnUrl(url, this.returnUrl)) return;

        event.preventDefault();
        const providerTransactionId = extractTransactionId(url);

        // `settle` primero: `close()` puede disparar `"closed"` de forma
        // síncrona, y como `settle` es idempotente, ese segundo intento
        // (CLOSED_BY_USER) debe perder contra éste, nunca ganarle.
        settle(
          providerTransactionId === null
            ? { outcome: "REDIRECT_MISSING_TRANSACTION_ID", paymentId: request.paymentId }
            : { outcome: "REDIRECTED", paymentId: request.paymentId, providerTransactionId },
        );
        checkoutWindow.close();
      };

      checkoutWindow.webContents.on("will-navigate", handleNavigation);
      checkoutWindow.webContents.on("will-redirect", handleNavigation);

      // El cierre manual (el cajero cancela, o ya se resolvió arriba y
      // `close()` dispara este mismo evento) converge en `settle`, que es
      // idempotente: sólo el primer resultado cuenta.
      checkoutWindow.on("closed", () => {
        settle({ outcome: "CLOSED_BY_USER", paymentId: request.paymentId });
      });

      void checkoutWindow.loadURL(request.checkoutUrl);
    });
  }
}
