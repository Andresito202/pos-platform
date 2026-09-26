import { useCallback, useRef, useState } from "react";
import type {
  PaymentCancelResult,
  PaymentGetResult,
  PaymentRegisterQrResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

/**
 * Cobro por QR de proveedor y cancelación de un pago abandonado.
 *
 * ## Un QR no es dinero
 *
 * `payment.register.qr` crea un `Payment` **PENDING** y guarda la referencia
 * comercial; la aprobación llega después y por otra vía —notificación del
 * proveedor o barrido de inciertos—. Por eso esta capa no declara cobrada
 * ninguna venta al registrar el intent, y la pantalla lee el estado real con
 * `payment.get` en vez de deducirlo. `PaymentProviderPort` lo dice sin rodeos:
 * «A QR image alone is not payment evidence and must never complete a payment».
 *
 * ## La referencia no la elige el renderer
 *
 * `provider_reference` llega del servicio, que impone `paymentId` como
 * referencia comercial (`DEC-016` §21). El renderer la muestra y no la
 * construye: elegirla aquí entregaría a un tercero una cadena escogida por el
 * llamador. Lo mismo vale para `checkout_url`, que firma el proveedor.
 *
 * ## Cancelar no es revertir
 *
 * `payment.cancel` libera a la venta de un componente que el operador
 * abandonó, y sólo funciona sobre un pago **no confirmado**. Un pago confirmado
 * es inmutable (`DEC-002`): deshacerlo es una operación compensatoria
 * (`Refund`/`Reversal`) que V1 no implementa —la deuda **D-22**—, así que
 * `PAYMENT_NOT_CANCELLABLE` no es un fallo sino la regla financiera
 * funcionando, y como tal se muestra.
 *
 * `expected_version` sale siempre de una lectura previa, nunca de un contador
 * propio: es control optimista de concurrencia, y `VERSION_CONFLICT` significa
 * que alguien más movió el pago entre la lectura y la orden.
 */

export interface ProviderPaymentState {
  readonly busy: boolean;
  readonly qr: PaymentRegisterQrResult | null;
  readonly payment: PaymentGetResult | null;
  readonly cancelled: PaymentCancelResult | null;
  readonly error: string | null;
}

export function useProviderPayment(): ProviderPaymentState & {
  chargeWithQr(saleId: string, amount: string): Promise<void>;
  readPayment(paymentId: string): Promise<void>;
  cancelPayment(paymentId: string, expectedVersion: number): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<PaymentRegisterQrResult | null>(null);
  const [payment, setPayment] = useState<PaymentGetResult | null>(null);
  const [cancelled, setCancelled] = useState<PaymentCancelResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Ver el comentario homónimo en `useCommercialSale.ts`: un `busy` de estado
   * no cierra la ventana entre dos clics; un `ref` sí, porque se lee y se
   * escribe de forma síncrona, sin esperar a un repintado. */
  const inFlight = useRef(false);

  /**
   * Conserva el resultado aunque el sobre venga rechazado: `PROVIDER_REJECTED`,
   * `PAYMENT_NOT_CANCELLABLE` y `VERSION_CONFLICT` son desenlaces que el cajero
   * necesita leer por su nombre. Sólo un `result` nulo deja a la pantalla sin
   * nada que mostrar, y entonces sí es un error.
   */
  const run = useCallback(async <T,>(
    call: () => Promise<{ result: T | null; result_code: string }>,
    apply: (result: T) => void,
  ): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await call();
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      apply(response.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const chargeWithQr = useCallback(async (saleId: string, amount: string): Promise<void> => {
    setCancelled(null);
    setPayment(null);
    await run<PaymentRegisterQrResult>(
      () => callCommercial("payment.register.qr", { sale_id: saleId, amount }, newIdempotencyKey()),
      setQr,
    );
  }, [run]);

  // Lectura pura: sin `idempotency_key` y sin `operation_id`, porque no muta.
  const readPayment = useCallback(async (paymentId: string): Promise<void> => {
    await run<PaymentGetResult>(
      () => callCommercial("payment.get", { payment_id: paymentId }),
      setPayment,
    );
  }, [run]);

  const cancelPayment = useCallback(async (
    paymentId: string,
    expectedVersion: number,
  ): Promise<void> => {
    await run<PaymentCancelResult>(
      () => callCommercial(
        "payment.cancel",
        { payment_id: paymentId, expected_version: expectedVersion },
        newIdempotencyKey(),
      ),
      setCancelled,
    );
  }, [run]);

  return { busy, qr, payment, cancelled, error, chargeWithQr, readPayment, cancelPayment };
}
