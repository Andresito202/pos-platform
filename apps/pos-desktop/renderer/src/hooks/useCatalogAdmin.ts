import { useCallback, useRef, useState } from "react";
import type {
  CatalogConversionDeclareResult,
  CatalogFiscalAttributeSetResult,
  CatalogPresentationAddResult,
  CatalogProductRegisterResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { toScale6 } from "../scale6.js";

/**
 * Alta de producto — lo que faltaba para que `B6` dejara de ser media capacidad.
 *
 * `catalog.item.find` y `catalog.item.get` ya tenían pantalla desde la venta;
 * `catalog.product.register` no tenía ninguna, de modo que **nadie podía cargar
 * un producto**. Un POS sin alta de catálogo no es un POS a medio hacer: es un
 * POS que no se puede usar el primer día.
 *
 * `setFiscalAttribute` cierra la otra mitad (`D-19`): el alta deja el producto
 * vendible, no facturable. Sin los códigos DIAN de la presentación, la emisión
 * se detiene en `LINE_FISCAL_ATTRIBUTE_MISSING` con la venta ya cobrada. Va
 * aquí, junto al alta, porque es quien da de alta quien los conoce.
 */

export interface RegisteredProduct {
  readonly productId: string;
  readonly presentationId: string;
  readonly outcome: CatalogProductRegisterResult["outcome"];
}

export interface CatalogAdminInput {
  readonly code: string;
  readonly name: string;
  readonly stockControlled: boolean;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string;
  /** Tal como lo teclea el operador: `1500`, `1500,50`. */
  readonly price: string;
  readonly currencyCode: string;
}

export interface FiscalAttributeInput {
  readonly presentationId: string;
  readonly codeReference: string;
  readonly unitMeasureCode: string;
  readonly standardCode: string;
  readonly taxCode: string;
  /** Tal como lo teclea el operador: `19`, `19,5`. */
  readonly taxRate: string;
}

/** Qué código no se verificó y dónde. Nunca el valor. */
export type FiscalAttributeFinding = CatalogFiscalAttributeSetResult["findings"][number];

export interface PresentationInput {
  readonly productId: string;
  readonly name: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string;
  /** Tal como lo teclea el operador: `1500`, `1500,50`. */
  readonly price: string;
  readonly currencyCode: string;
}

export interface ConversionInput {
  readonly productId: string;
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  /** Cuántas unidades de destino produce una de origen: `12`, `12,5`. */
  readonly factor: string;
  readonly reversible: boolean;
}

export interface CatalogAdminState {
  readonly busy: boolean;
  readonly product: RegisteredProduct | null;
  /** Desenlace del contrato cuando no hubo alta: `UNAUTHORIZED`, conflicto… */
  readonly outcome: CatalogProductRegisterResult["outcome"] | null;
  readonly error: string | null;
  readonly fiscalOutcome: CatalogFiscalAttributeSetResult["outcome"] | null;
  readonly fiscalFindings: readonly FiscalAttributeFinding[];
  readonly presentationOutcome: CatalogPresentationAddResult["outcome"] | null;
  readonly conversionOutcome: CatalogConversionDeclareResult["outcome"] | null;
  /** La presentación recién añadida, o la que ya usaba el código de barras. */
  readonly addedPresentationId: string | null;
}

export function useCatalogAdmin(): CatalogAdminState & {
  registerProduct(input: CatalogAdminInput): Promise<void>;
  setFiscalAttribute(input: FiscalAttributeInput): Promise<void>;
  addPresentation(input: PresentationInput): Promise<void>;
  declareConversion(input: ConversionInput): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<RegisteredProduct | null>(null);
  const [outcome, setOutcome] = useState<CatalogProductRegisterResult["outcome"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fiscalOutcome, setFiscalOutcome] =
    useState<CatalogFiscalAttributeSetResult["outcome"] | null>(null);
  const [fiscalFindings, setFiscalFindings] = useState<readonly FiscalAttributeFinding[]>([]);
  const [presentationOutcome, setPresentationOutcome] =
    useState<CatalogPresentationAddResult["outcome"] | null>(null);
  const [addedPresentationId, setAddedPresentationId] = useState<string | null>(null);
  const [conversionOutcome, setConversionOutcome] =
    useState<CatalogConversionDeclareResult["outcome"] | null>(null);

  /** Ver `useCommercialSale.ts`: cierra la ventana de doble clic que un
   * `busy` de estado, por sí solo, no cierra. Un solo `ref`: las cuatro
   * acciones comparten el mismo `busy`, así que comparten la misma marca. */
  const inFlight = useRef(false);

  const registerProduct = useCallback(async (input: CatalogAdminInput): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setProduct(null);
    try {
      // El precio se normaliza aquí y se rechaza si no cabe en escala 6. Enviar
      // lo tecleado en crudo lo rechazaría la frontera con un error de expresión
      // regular, que al operador no le dice nada.
      const price = toScale6(input.price);
      if (price === null) {
        setError("PRICE_NOT_SCALE6");
        return;
      }

      const response = await callCommercial<CatalogProductRegisterResult>(
        "catalog.product.register",
        {
          code: input.code,
          name: input.name,
          stock_controlled: input.stockControlled,
          presentation_name: input.presentationName,
          unit_code: input.unitCode,
          unit_precision: input.unitPrecision,
          // El contrato admite `null`, y un producto a granel sin código de
          // barras es un caso corriente, no un error de captura.
          barcode: input.barcode.trim() === "" ? null : input.barcode.trim(),
          price_amount: price,
          currency_code: input.currencyCode,
        },
        newIdempotencyKey(),
      );

      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setOutcome(response.result.outcome);
      const { product_id: productId, presentation_id: presentationId } = response.result;
      if (productId !== null && presentationId !== null) {
        setProduct({ productId, presentationId, outcome: response.result.outcome });
      }
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const setFiscalAttribute = useCallback(async (input: FiscalAttributeInput): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setFiscalOutcome(null);
    setFiscalFindings([]);
    try {
      // La tasa se normaliza aquí por la misma razón que el precio: `19` no es
      // escala 6 y la frontera lo rechazaría con un error de expresión regular
      // que al operador no le dice nada.
      const rate = toScale6(input.taxRate);
      if (rate === null) {
        setError("TAX_RATE_NOT_SCALE6");
        return;
      }

      const response = await callCommercial<CatalogFiscalAttributeSetResult>(
        "catalog.fiscal.attribute.set",
        {
          presentation_id: input.presentationId.trim(),
          code_reference: input.codeReference.trim(),
          unit_measure_code: input.unitMeasureCode.trim(),
          standard_code: input.standardCode.trim(),
          tax_code: input.taxCode.trim(),
          tax_rate: rate,
          status: "ACTIVE",
        },
        newIdempotencyKey(),
      );

      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setFiscalOutcome(response.result.outcome);
      setFiscalFindings(response.result.findings);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const addPresentation = useCallback(async (input: PresentationInput): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setPresentationOutcome(null);
    setAddedPresentationId(null);
    try {
      const price = toScale6(input.price);
      if (price === null) {
        setError("PRICE_NOT_SCALE6");
        return;
      }

      const response = await callCommercial<CatalogPresentationAddResult>(
        "catalog.presentation.add",
        {
          product_id: input.productId.trim(),
          name: input.name.trim(),
          unit_code: input.unitCode.trim(),
          unit_precision: input.unitPrecision,
          // Una presentación a granel sin código de barras es corriente, no un
          // error de captura. Misma regla que el alta.
          barcode: input.barcode.trim() === "" ? null : input.barcode.trim(),
          price_amount: price,
          currency_code: input.currencyCode.trim(),
        },
        newIdempotencyKey(),
      );

      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setPresentationOutcome(response.result.outcome);
      // También en el rechazo por código duplicado: dice **cuál** presentación
      // lo usa ya, que es lo que el operador necesita para ir a ella.
      setAddedPresentationId(response.result.presentation_id);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  /** Declarar no convierte nada: deja escrito el factor. */
  const declareConversion = useCallback(async (input: ConversionInput): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setConversionOutcome(null);
    try {
      const factor = toScale6(input.factor);
      if (factor === null) {
        setError("FACTOR_NOT_SCALE6");
        return;
      }
      const response = await callCommercial<CatalogConversionDeclareResult>(
        "catalog.conversion.declare",
        {
          product_id: input.productId.trim(),
          source_presentation_id: input.sourcePresentationId.trim(),
          target_presentation_id: input.targetPresentationId.trim(),
          factor,
          reversible: input.reversible,
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setConversionOutcome(response.result.outcome);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return {
    busy, product, outcome, error, fiscalOutcome, fiscalFindings,
    presentationOutcome, addedPresentationId, conversionOutcome,
    registerProduct, setFiscalAttribute, addPresentation, declareConversion,
  };
}
