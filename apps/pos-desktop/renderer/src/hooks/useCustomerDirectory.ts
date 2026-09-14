import { useCallback, useState } from "react";
import type {
  CustomerReadResult,
  CustomerRegisterResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

/**
 * Adquiriente — lo que faltaba para `B10`, que no tenía **ninguna** pantalla.
 *
 * Las tres operaciones cruzaban el canal y ninguna era alcanzable desde el
 * producto. Sin adquiriente no hay factura electrónica nominativa, así que esta
 * pantalla es también el primer peldaño real hacia el bloque fiscal.
 *
 * Los códigos DIAN —documento, organización legal, tributo, responsabilidades—
 * viajan **tal como se teclean**. La pantalla no los traduce ni los adivina: el
 * servicio los valida contra las tablas de `D-9`, y un código inventado aquí
 * debe ser rechazado allí, no maquillado aquí.
 */

export interface CustomerRegistration {
  readonly identificationDocumentCode: string;
  readonly identification: string;
  readonly verificationDigit: string;
  readonly legalOrganizationCode: string;
  readonly company: string;
  readonly names: string;
  readonly tributeCode: string;
  readonly fiscalResponsibilityCodes: readonly string[];
  readonly email: string;
  readonly phone: string;
}

export interface CustomerDirectoryState {
  readonly busy: boolean;
  readonly registered: CustomerRegisterResult | null;
  readonly found: CustomerReadResult | null;
  readonly error: string | null;
}

/** Un campo vacío es ausencia, no cadena vacía: el contrato pide `null`. */
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function useCustomerDirectory(): CustomerDirectoryState & {
  register(input: CustomerRegistration): Promise<void>;
  find(documentCode: string, identification: string): Promise<void>;
  get(customerId: string): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<CustomerRegisterResult | null>(null);
  const [found, setFound] = useState<CustomerReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (input: CustomerRegistration): Promise<void> => {
    setBusy(true);
    setError(null);
    setRegistered(null);
    try {
      const response = await callCommercial<CustomerRegisterResult>(
        "customer.register",
        {
          identification_document_code: input.identificationDocumentCode,
          identification: input.identification,
          verification_digit: optional(input.verificationDigit),
          legal_organization_code: input.legalOrganizationCode,
          company: optional(input.company),
          names: optional(input.names),
          tribute_code: input.tributeCode,
          fiscal_responsibility_codes: input.fiscalResponsibilityCodes,
          email: optional(input.email),
          phone: optional(input.phone),
          address: null,
          country_code: null,
          municipality_code: null,
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      // Se guarda también el rechazo: `findings` es lo que dice **qué** campo
      // fiscal está mal, y ocultarlo dejaría al operador adivinando.
      setRegistered(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const read = useCallback(async (
    messageType: "customer.find" | "customer.get",
    payload: unknown,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const response = await callCommercial<CustomerReadResult>(messageType, payload);
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setFound(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const find = useCallback((documentCode: string, identification: string) => read(
    "customer.find",
    { identification_document_code: documentCode, identification },
  ), [read]);

  const get = useCallback((customerId: string) => read(
    "customer.get", { customer_id: customerId },
  ), [read]);

  return { busy, registered, found, error, register, find, get };
}
