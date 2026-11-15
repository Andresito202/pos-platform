import { useCallback, useState } from "react";
import type {
  CatalogFoodPolicyUpsertResult,
  CatalogItemListItem,
  CatalogPresentationRegisterResult,
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
  readonly fiscalAttributes?: {
    readonly codeReference: string; readonly unitMeasureCode: string; readonly standardCode: string;
    readonly taxCode: string; readonly taxRate: string;
  };
}

export interface SecondaryPresentationInput {
  readonly productId: string;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string;
  readonly price: string;
  readonly currencyCode: string;
}

export interface FoodPolicyInput {
  readonly productId: string;
  readonly conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
  readonly requiresLotTracking: boolean;
  readonly requiresExpiry: boolean;
  readonly notes: string;
}

export interface CatalogAdminState {
  readonly busy: boolean;
  readonly product: RegisteredProduct | null;
  /** Desenlace del contrato cuando no hubo alta: `UNAUTHORIZED`, conflicto… */
  readonly outcome: CatalogProductRegisterResult["outcome"] | null;
  readonly presentationOutcome: CatalogPresentationRegisterResult["outcome"] | null;
  readonly foodPolicyOutcome: CatalogFoodPolicyUpsertResult["outcome"] | null;
  readonly foodPolicyVersion: number | null;
  readonly error: string | null;
}

export function useCatalogAdmin(): CatalogAdminState & {
  registerProduct(input: CatalogAdminInput): Promise<void>;
  registerPresentation(input: SecondaryPresentationInput): Promise<void>;
  upsertFoodPolicy(input: FoodPolicyInput): Promise<void>;
  items: readonly CatalogItemListItem[];
  hasMore: boolean;
  listItems(query: string, offset?: number): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<RegisteredProduct | null>(null);
  const [outcome, setOutcome] = useState<CatalogProductRegisterResult["outcome"] | null>(null);
  const [presentationOutcome, setPresentationOutcome] = useState<CatalogPresentationRegisterResult["outcome"] | null>(null);
  const [foodPolicyOutcome, setFoodPolicyOutcome] = useState<CatalogFoodPolicyUpsertResult["outcome"] | null>(null);
  const [foodPolicyVersion, setFoodPolicyVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<readonly CatalogItemListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const listItems = useCallback(async (query: string, offset = 0): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const response = await callCommercial<{ outcome: string; items: CatalogItemListItem[]; has_more: boolean }>(
        "catalog.item.list", { query, limit: 24, offset },
      );
      if (response.status !== "SUCCEEDED" || response.result?.outcome !== "FOUND") {
        setError(response.result_code); return;
      }
      setItems((previous) => offset === 0 ? response.result!.items : [...previous, ...response.result!.items]);
      setHasMore(response.result.has_more);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally { setBusy(false); }
  }, []);

  const registerProduct = useCallback(async (input: CatalogAdminInput): Promise<void> => {
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
      const fiscal = input.fiscalAttributes;
      const taxRate = fiscal === undefined ? null : toScale6(fiscal.taxRate);
      if (fiscal !== undefined && taxRate === null) { setError("TAX_RATE_NOT_SCALE6"); return; }

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
          ...(fiscal === undefined ? {} : { fiscal_attributes: {
            code_reference: fiscal.codeReference, unit_measure_code: fiscal.unitMeasureCode,
            standard_code: fiscal.standardCode, tax_code: fiscal.taxCode, tax_rate: taxRate!,
          } }),
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
      setBusy(false);
    }
  }, []);

  const registerPresentation = useCallback(async (input: SecondaryPresentationInput): Promise<void> => {
    setBusy(true);
    setError(null);
    setPresentationOutcome(null);
    try {
      const price = toScale6(input.price);
      if (price === null) {
        setError("PRICE_NOT_SCALE6");
        return;
      }
      const response = await callCommercial<CatalogPresentationRegisterResult>(
        "catalog.presentation.register",
        {
          product_id: input.productId,
          presentation_name: input.presentationName,
          unit_code: input.unitCode,
          unit_precision: input.unitPrecision,
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
      setPresentationOutcome(response.result.outcome);
      const { product_id: productId, presentation_id: presentationId } = response.result;
      if (productId !== null && presentationId !== null) {
        setProduct({ productId, presentationId, outcome: response.result.outcome === "IDEMPOTENT" ? "IDEMPOTENT" : "REGISTERED" });
      }
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const upsertFoodPolicy = useCallback(async (input: FoodPolicyInput): Promise<void> => {
    setBusy(true);
    setError(null);
    setFoodPolicyOutcome(null);
    setFoodPolicyVersion(null);
    try {
      const response = await callCommercial<CatalogFoodPolicyUpsertResult>(
        "catalog.food_policy.upsert",
        {
          product_id: input.productId,
          conservation_code: input.conservationCode,
          requires_lot_tracking: input.requiresLotTracking,
          requires_expiry: input.requiresExpiry,
          notes: input.notes.trim() === "" ? null : input.notes.trim(),
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setFoodPolicyOutcome(response.result.outcome);
      setFoodPolicyVersion(response.result.version);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    busy, product, outcome, presentationOutcome, foodPolicyOutcome, foodPolicyVersion, error,
    registerProduct, registerPresentation, upsertFoodPolicy, items, hasMore, listItems,
  };
}
