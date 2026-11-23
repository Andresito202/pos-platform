import { useCallback, useState } from "react";
import {
  CatalogItemListResultSchema,
  type CatalogFoodPolicyUpsertResult,
  type CatalogItemListItem,
  type CatalogMediaMutateResult,
  type CatalogPricePublishResult,
  type CatalogProductRegisterResult,
  type CatalogProductUpdateResult,
} from "@pos-platform/contracts";
import { forgetCatalogMedia } from "../catalog-media-cache.js";
import { notifyCatalogInventoryChanged } from "../catalog-invalidate.js";
import { prepareCatalogCardImage } from "../catalog-media-resize.js";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { toScale6 } from "../scale6.js";

/**
 * Alta y edición administrativa de productos — UC-CAT-002 + precio + media.
 * El stock no se muta desde este hook; Inventario conserva recepción/ajuste.
 */

export interface RegisteredProduct {
  readonly productId: string;
  readonly presentationId: string;
  readonly outcome: CatalogProductRegisterResult["outcome"];
}

export interface CatalogFiscalAttributesInput {
  readonly codeReference: string;
  readonly unitMeasureCode: string;
  readonly standardCode: string;
  readonly taxCode: string;
  /** Operator-typed rate; normalized to scale-6 before IPC. */
  readonly taxRate: string;
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
  /** Optional DIAN attributes required before electronic issuance. */
  readonly fiscalAttributes?: CatalogFiscalAttributesInput;
}

export interface FoodPolicyInput {
  readonly productId: string;
  readonly conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
  readonly requiresLotTracking: boolean;
  readonly requiresExpiry: boolean;
  readonly notes: string;
}

export interface UpdateProductInput {
  readonly productId: string;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly code?: string;
  readonly status?: "ACTIVE" | "INACTIVE";
  readonly presentationId?: string;
  readonly presentationExpectedVersion?: number;
  readonly presentationName?: string;
  readonly barcode?: string | null;
  readonly reason?: string | null;
}

export interface PublishPriceInput {
  readonly presentationId: string;
  readonly amount: string;
  readonly currencyCode: string;
}

export interface PutMediaInput {
  readonly productId: string;
  readonly expectedVersion: number;
  readonly file: File;
  readonly previousMediaId?: string | null;
}

export interface ClearMediaInput {
  readonly productId: string;
  readonly expectedVersion: number;
  readonly previousMediaId?: string | null;
}

export interface CatalogAdminState {
  readonly busy: boolean;
  readonly product: RegisteredProduct | null;
  /** Desenlace del contrato cuando no hubo alta: `UNAUTHORIZED`, conflicto… */
  readonly outcome: CatalogProductRegisterResult["outcome"] | null;
  readonly updateOutcome: CatalogProductUpdateResult["outcome"] | null;
  readonly updateVersion: number | null;
  readonly updatePresentationVersion: number | null;
  readonly updateCurrentVersion: number | null;
  readonly priceOutcome: CatalogPricePublishResult["outcome"] | null;
  readonly mediaOutcome: CatalogMediaMutateResult["outcome"] | null;
  readonly mediaId: string | null;
  readonly mediaVersion: number | null;
  readonly mediaCurrentVersion: number | null;
  readonly editCandidates: readonly CatalogItemListItem[];
  readonly foodPolicyOutcome: CatalogFoodPolicyUpsertResult["outcome"] | null;
  readonly foodPolicyVersion: number | null;
  readonly error: string | null;
}

export function useCatalogAdmin(): CatalogAdminState & {
  registerProduct(input: CatalogAdminInput): Promise<void>;
  searchEditCandidates(query: string): Promise<readonly CatalogItemListItem[]>;
  updateProduct(input: UpdateProductInput): Promise<CatalogProductUpdateResult | null>;
  publishPrice(input: PublishPriceInput): Promise<CatalogPricePublishResult | null>;
  putMedia(input: PutMediaInput): Promise<CatalogMediaMutateResult | null>;
  clearMedia(input: ClearMediaInput): Promise<CatalogMediaMutateResult | null>;
  upsertFoodPolicy(input: FoodPolicyInput): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<RegisteredProduct | null>(null);
  const [outcome, setOutcome] = useState<CatalogProductRegisterResult["outcome"] | null>(null);
  const [updateOutcome, setUpdateOutcome] = useState<CatalogProductUpdateResult["outcome"] | null>(null);
  const [updateVersion, setUpdateVersion] = useState<number | null>(null);
  const [updatePresentationVersion, setUpdatePresentationVersion] = useState<number | null>(null);
  const [updateCurrentVersion, setUpdateCurrentVersion] = useState<number | null>(null);
  const [priceOutcome, setPriceOutcome] = useState<CatalogPricePublishResult["outcome"] | null>(null);
  const [mediaOutcome, setMediaOutcome] = useState<CatalogMediaMutateResult["outcome"] | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [mediaVersion, setMediaVersion] = useState<number | null>(null);
  const [mediaCurrentVersion, setMediaCurrentVersion] = useState<number | null>(null);
  const [editCandidates, setEditCandidates] = useState<readonly CatalogItemListItem[]>([]);
  const [foodPolicyOutcome, setFoodPolicyOutcome] = useState<CatalogFoodPolicyUpsertResult["outcome"] | null>(null);
  const [foodPolicyVersion, setFoodPolicyVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const registerProduct = useCallback(async (input: CatalogAdminInput): Promise<void> => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setProduct(null);
    try {
      const price = toScale6(input.price);
      if (price === null) {
        setError("PRICE_NOT_SCALE6");
        return;
      }

      let fiscal_attributes: {
        code_reference: string;
        unit_measure_code: string;
        standard_code: string;
        tax_code: string;
        tax_rate: string;
      } | undefined;
      if (input.fiscalAttributes !== undefined) {
        const taxRate = toScale6(input.fiscalAttributes.taxRate);
        if (taxRate === null) {
          setError("TAX_RATE_NOT_SCALE6");
          return;
        }
        fiscal_attributes = {
          code_reference: input.fiscalAttributes.codeReference.trim(),
          unit_measure_code: input.fiscalAttributes.unitMeasureCode.trim(),
          standard_code: input.fiscalAttributes.standardCode.trim(),
          tax_code: input.fiscalAttributes.taxCode.trim(),
          tax_rate: taxRate,
        };
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
          barcode: input.barcode.trim() === "" ? null : input.barcode.trim(),
          price_amount: price,
          currency_code: input.currencyCode,
          ...(fiscal_attributes === undefined ? {} : { fiscal_attributes }),
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
        notifyCatalogInventoryChanged();
      }
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const searchEditCandidates = useCallback(async (query: string): Promise<readonly CatalogItemListItem[]> => {
    setBusy(true);
    setError(null);
    try {
      const response = await callCommercial("catalog.item.list", {
        query, limit: 24, offset: 0,
      });
      const parsed = CatalogItemListResultSchema.safeParse(response.result);
      if (response.status !== "SUCCEEDED" || !parsed.success || parsed.data.outcome !== "FOUND") {
        setError(response.result_code);
        setEditCandidates([]);
        return [];
      }
      setEditCandidates(parsed.data.items);
      return parsed.data.items;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setEditCandidates([]);
      return [];
    } finally {
      setBusy(false);
    }
  }, []);

  const updateProduct = useCallback(async (
    input: UpdateProductInput,
  ): Promise<CatalogProductUpdateResult | null> => {
    setBusy(true);
    setError(null);
    setUpdateOutcome(null);
    setUpdateVersion(null);
    setUpdatePresentationVersion(null);
    setUpdateCurrentVersion(null);
    try {
      const response = await callCommercial<CatalogProductUpdateResult>(
        "catalog.product.update",
        {
          product_id: input.productId,
          expected_version: input.expectedVersion,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.presentationId !== undefined ? { presentation_id: input.presentationId } : {}),
          ...(input.presentationExpectedVersion !== undefined
            ? { presentation_expected_version: input.presentationExpectedVersion }
            : {}),
          ...(input.presentationName !== undefined
            ? { presentation_name: input.presentationName }
            : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return null;
      }
      setUpdateOutcome(response.result.outcome);
      setUpdateVersion(response.result.version);
      setUpdatePresentationVersion(response.result.presentation_version);
      setUpdateCurrentVersion(response.result.current_version);
      if (response.result.outcome === "UPDATED" || response.result.outcome === "IDEMPOTENT") {
        notifyCatalogInventoryChanged();
      }
      return response.result;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const publishPrice = useCallback(async (
    input: PublishPriceInput,
  ): Promise<CatalogPricePublishResult | null> => {
    setBusy(true);
    setError(null);
    setPriceOutcome(null);
    try {
      const amount = toScale6(input.amount);
      if (amount === null) {
        setError("PRICE_NOT_SCALE6");
        return null;
      }
      const response = await callCommercial<CatalogPricePublishResult>(
        "catalog.price.publish",
        {
          presentation_id: input.presentationId,
          amount,
          currency_code: input.currencyCode,
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return null;
      }
      setPriceOutcome(response.result.outcome);
      if (response.result.outcome === "PUBLISHED" || response.result.outcome === "IDEMPOTENT") {
        notifyCatalogInventoryChanged();
      }
      return response.result;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const putMedia = useCallback(async (
    input: PutMediaInput,
  ): Promise<CatalogMediaMutateResult | null> => {
    setBusy(true);
    setError(null);
    setMediaOutcome(null);
    setMediaId(null);
    setMediaVersion(null);
    setMediaCurrentVersion(null);
    try {
      const prepared = await prepareCatalogCardImage(input.file);
      if (!prepared.ok) {
        setError(prepared.reason);
        return null;
      }
      const response = await callCommercial<CatalogMediaMutateResult>(
        "catalog.media.put",
        {
          product_id: input.productId,
          expected_version: input.expectedVersion,
          content_base64: prepared.contentBase64,
        },
      );
      if (response.result === null) {
        setError(response.result_code);
        return null;
      }
      setMediaOutcome(response.result.outcome);
      setMediaId(response.result.media_id);
      setMediaVersion(response.result.version);
      setMediaCurrentVersion(response.result.current_version);
      if (response.result.outcome === "ATTACHED") {
        if (input.previousMediaId) forgetCatalogMedia(input.previousMediaId);
        notifyCatalogInventoryChanged();
      }
      return response.result;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearMedia = useCallback(async (
    input: ClearMediaInput,
  ): Promise<CatalogMediaMutateResult | null> => {
    setBusy(true);
    setError(null);
    setMediaOutcome(null);
    setMediaId(null);
    setMediaVersion(null);
    setMediaCurrentVersion(null);
    try {
      const response = await callCommercial<CatalogMediaMutateResult>(
        "catalog.media.clear",
        {
          product_id: input.productId,
          expected_version: input.expectedVersion,
        },
      );
      if (response.result === null) {
        setError(response.result_code);
        return null;
      }
      setMediaOutcome(response.result.outcome);
      setMediaId(response.result.media_id);
      setMediaVersion(response.result.version);
      setMediaCurrentVersion(response.result.current_version);
      if (input.previousMediaId) forgetCatalogMedia(input.previousMediaId);
      if (response.result.outcome === "ATTACHED") {
        notifyCatalogInventoryChanged();
      }
      return response.result;
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      return null;
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
    busy,
    product,
    outcome,
    updateOutcome,
    updateVersion,
    updatePresentationVersion,
    updateCurrentVersion,
    priceOutcome,
    mediaOutcome,
    mediaId,
    mediaVersion,
    mediaCurrentVersion,
    editCandidates,
    foodPolicyOutcome,
    foodPolicyVersion,
    error,
    registerProduct,
    searchEditCandidates,
    updateProduct,
    publishPrice,
    putMedia,
    clearMedia,
    upsertFoodPolicy,
  };
}
