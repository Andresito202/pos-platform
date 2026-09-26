import { useCallback, useRef, useState } from "react";
import type {
  CreditAccountGetResult,
  CreditAccountOpenResult,
  CreditPaymentRegisterResult,
  PaymentRegisterCreditResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

/**
 * Crédito de cliente — `DEC-005`, la tienda de barrio.
 *
 * Las cuatro operaciones existían completas en el servicio local desde hacía
 * bloques y **ninguna era alcanzable desde el producto**: sus canales ni
 * siquiera estaban en la allowlist del Desktop. Expuestos los canales, faltaba
 * la pantalla. Esto es esa pantalla.
 *
 * ## Lo que esta capa deliberadamente NO hace
 *
 * **No calcula cupo, saldo ni disponible.** Los tres salen del libro del
 * cliente, recomputados por la capa confiable dentro de la misma transacción
 * que registra la deuda (`DEC-005`). Un disponible calculado aquí sería un
 * número que el cajero podría ver distinto del real justo cuando importa.
 *
 * **No reintenta un `CREDIT_LIMIT_EXCEEDED`.** Es un rechazo duro y sin
 * override por contrato: la pantalla muestra cuánto quedaba de verdad y deja
 * la decisión al humano, que es quien puede cobrar en efectivo la diferencia.
 *
 * **No abre cuentas de paso.** Fiar es una decisión deliberada por cliente, y
 * ninguna otra operación la toma por su cuenta.
 */

export interface CreditState {
  readonly busy: boolean;
  readonly opened: CreditAccountOpenResult | null;
  readonly account: CreditAccountGetResult | null;
  readonly charged: PaymentRegisterCreditResult | null;
  readonly repaid: CreditPaymentRegisterResult | null;
  readonly error: string | null;
}

export interface OpenAccountInput {
  readonly customerId: string;
  readonly creditLimit: string;
  readonly currencyCode: string;
}

export interface RepaymentInput {
  readonly customerId: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly method: "CASH" | "TRANSFER";
  readonly cashRegisterId: string;
  readonly businessDate: string;
}

export function useCustomerCredit(): CreditState & {
  openAccount(input: OpenAccountInput): Promise<void>;
  readAccount(customerId: string): Promise<void>;
  chargeToCredit(saleId: string, amount: string): Promise<void>;
  registerRepayment(input: RepaymentInput): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<CreditAccountOpenResult | null>(null);
  const [account, setAccount] = useState<CreditAccountGetResult | null>(null);
  const [charged, setCharged] = useState<PaymentRegisterCreditResult | null>(null);
  const [repaid, setRepaid] = useState<CreditPaymentRegisterResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Ver `useCommercialSale.ts`: cierra la ventana de doble clic que un
   * `busy` de estado, por sí solo, no cierra. */
  const inFlight = useRef(false);

  /**
   * Envuelve una llamada y guarda su resultado.
   *
   * El resultado se conserva **aunque el `outcome` sea un rechazo**: el
   * contrato los enumera por nombre —`CREDIT_LIMIT_EXCEEDED`,
   * `CUSTOMER_REQUIRED`, `REPAYMENT_EXCEEDS_BALANCE`— y cada uno le dice al
   * cajero qué hacer. Colapsarlos a un error genérico tiraría justo la
   * información útil. Sólo el sobre sin `result` es error de transporte.
   */
  const run = useCallback(async <T>(
    call: () => Promise<{ result: T | null; result_code: string }>,
    store: (value: T) => void,
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
      store(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const openAccount = useCallback((input: OpenAccountInput) => run(
    () => callCommercial<CreditAccountOpenResult>(
      "credit.account.open",
      {
        customer_id: input.customerId,
        credit_limit: input.creditLimit,
        currency_code: input.currencyCode,
      },
      newIdempotencyKey(),
    ),
    (value) => { setOpened(value); },
  ), [run]);

  const readAccount = useCallback((customerId: string) => run(
    // Lectura: sin `idempotency_key`, como exige el sobre.
    () => callCommercial<CreditAccountGetResult>(
      "credit.account.get", { customer_id: customerId },
    ),
    (value) => { setAccount(value); },
  ), [run]);

  const chargeToCredit = useCallback((saleId: string, amount: string) => run(
    () => callCommercial<PaymentRegisterCreditResult>(
      "payment.register.credit",
      { sale_id: saleId, amount },
      newIdempotencyKey(),
    ),
    (value) => { setCharged(value); },
  ), [run]);

  const registerRepayment = useCallback((input: RepaymentInput) => run(
    () => callCommercial<CreditPaymentRegisterResult>(
      "credit.payment.register",
      {
        customer_id: input.customerId,
        amount: input.amount,
        currency_code: input.currencyCode,
        method: input.method,
        // Un abono en efectivo entra a un cajón concreto y el contrato exige
        // nombrarlo; una transferencia no toca caja, y ahí viaja `null`.
        cash_register_id: input.method === "CASH" ? input.cashRegisterId : null,
        business_date: input.businessDate,
      },
      newIdempotencyKey(),
    ),
    (value) => { setRepaid(value); },
  ), [run]);

  return {
    busy, opened, account, charged, repaid, error,
    openAccount, readAccount, chargeToCredit, registerRepayment,
  };
}
