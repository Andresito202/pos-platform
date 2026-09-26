import { useCallback, useState } from "react";
import type { FiscalDocumentListResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * Las facturas de una venta y a quién se facturó cada una
 * (`fiscal.document.list`, Electronic Invoicing).
 *
 * `saleId` es la venta de la que son estos documentos: la pantalla sólo los
 * muestra junto a esa venta, para no dejar a la vista las facturas de otra.
 */
export interface SaleInvoicesState {
  readonly busy: boolean;
  readonly saleId: string | null;
  readonly documents: FiscalDocumentListResult["documents"] | null;
  readonly error: string | null;
}

export function useSaleInvoices(): SaleInvoicesState & { load(saleId: string): Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<FiscalDocumentListResult["documents"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setSaleId(null);
    setDocuments(null);
    try {
      const response = await callCommercial<FiscalDocumentListResult>(
        "fiscal.document.list", { sale_id: id },
      );
      if (response.result === null || response.result.outcome !== "LISTED") {
        setError(response.result?.outcome ?? response.result_code);
        return;
      }
      setSaleId(id);
      setDocuments(response.result.documents);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, saleId, documents, error, load };
}
