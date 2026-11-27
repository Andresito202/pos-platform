import { useEffect, useRef, useState } from "react";
import { FiscalDocumentDownloadResultSchema } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";
import { downloadBytes } from "../sheet-workbook.js";
import { useFiscalIssuance } from "../hooks/useFiscalIssuance.js";

const fiscalHistoryLabels = {
  CREATED: "Registrado",
  IN_PROGRESS: "En proceso",
  COMPLETED: "Procesado",
  FAILED: "Fallo de envío registrado",
  UNKNOWN_OUTCOME: "Resultado incierto · requiere revisión",
  CANCELLED: "Cancelado",
};

/**
 * Emisión fiscal de una venta ya cobrada — `DEC-021` F5.
 *
 * ## Por qué el adquiriente se elige, y no se teclea aquí
 *
 * El panel ofrece dos caminos —un adquiriente ya registrado por su id, o la
 * ausencia declarada con su motivo— y ninguno permite escribir los campos
 * fiscales del tercero. Eso es de `CustomerPanel`, que ya los valida contra las
 * tablas DIAN antes de guardarlos. Dejar teclearlos también aquí crearía un
 * segundo adquiriente que nadie validó, y el que acabaría en la factura sería
 * ése.
 *
 * ## Por qué el motivo del bloqueo se muestra tal cual
 *
 * Hoy, una venta de mostrador anónima **no se puede facturar**: `D-13`, el
 * tercero genérico de la DIAN no está verificado en este repositorio. El panel
 * no lo esconde ni lo traduce a «error»: muestra `GENERIC_ACQUIRER_NOT_VERIFIED`
 * con su ruta, porque es la diferencia entre «el sistema falló» y «esta venta
 * necesita un adquiriente identificado».
 */
export function FiscalPanel({ initialSaleId = null }: { initialSaleId?: string | null }): React.JSX.Element {
  const fiscal = useFiscalIssuance();
  const [saleId, setSaleId] = useState("");
  useEffect(() => { if (initialSaleId !== null) setSaleId(initialSaleId); }, [initialSaleId]);
  const [customerId, setCustomerId] = useState("");
  const [download, setDownload] = useState<{ id: string; error: boolean; text: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const pendingDownload = useRef(false);
  async function exportDocument(id: string, format: "PDF" | "XML") {
    if (pendingDownload.current) return;
    pendingDownload.current = true;
    setDownloading(true);
    setDownload(null);
    try {
      const response = await callCommercial("fiscal.document.download", { document_id: id, format });
      const parsed = FiscalDocumentDownloadResultSchema.safeParse(response.result);
      if (response.status !== "SUCCEEDED" || !parsed.success || parsed.data.document_id !== id || parsed.data.format !== format) {
        const text = response.result_code === "FISCAL_ARTIFACT_NOT_CONFIGURED"
          ? "La descarga desde FACTUS Sandbox requiere una conexión configurada."
          : "El archivo fiscal no está disponible para descarga.";
        setDownload({ id, error: true, text });
        return;
      }
      const bytes = Uint8Array.from(atob(parsed.data.content_base64), (char) => char.charCodeAt(0));
      downloadBytes(`documento-fiscal-${id}.${format.toLowerCase()}`, bytes,
        format === "XML" ? "application/xml" : "application/pdf");
      setDownload({ id, error: false, text: `Descarga ${format} solicitada. SHA-256 ${parsed.data.sha256}` });
    } catch {
      setDownload({ id, error: true, text: "No se pudo descargar el archivo fiscal." });
    } finally {
      pendingDownload.current = false;
      setDownloading(false);
    }
  }

  const issued = fiscal.resultSaleId === saleId.trim() ? fiscal.issued : null;
  const blocked = fiscal.isBlocked(saleId.trim(), "SALES_INVOICE");
  const history = fiscal.history?.sale_id === saleId.trim().toLowerCase() ? fiscal.history : null;

  return (
    <section data-testid="fiscal-panel">
      <h2>Emisión fiscal</h2>

      <input
        data-testid="fiscal-sale-id-input"
        aria-label="ID de la venta cobrada"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta cobrada"
        disabled={fiscal.busy}
      />
      <button
        type="button"
        data-testid="fiscal-list-button"
        disabled={fiscal.busy || saleId.trim() === ""}
        onClick={() => { void fiscal.listDocuments(saleId.trim()); }}
      >
        Consultar documentos de la venta
      </button>
      {fiscal.historyLoading && <p role="status">Consultando documentos guardados…</p>}
      {fiscal.historyError && <p role="alert">{fiscal.historyError}</p>}
      {history && (
        <section aria-label="Documentos guardados" data-testid="fiscal-document-history">
          <h3>Documentos guardados</h3>
          {history.outcome === "NOT_FOUND" ? (
            <p role="status">Esta venta no tiene documentos fiscales guardados en esta sucursal.</p>
          ) : (
            <ul>
              {history.documents.map(document => (
                <li key={document.document_id}>
                  <strong>{document.document_type === "SALES_INVOICE" ? "Factura de venta"
                    : document.document_type === "CREDIT_NOTE" ? "Nota crédito" : document.document_type}</strong>
                  {" · "}
                  {document.normalized_result === "ACCEPTED" ? "Aceptado"
                    : document.normalized_result === "REJECTED" ? "Rechazado"
                    : fiscalHistoryLabels[document.transport_status]}
                  {document.issued_number && <div>Número {document.issued_number}</div>}
                  {document.cufe && <div style={{ overflowWrap: "anywhere" }}>CUFE/CUDE {document.cufe}</div>}
                  {document.normalized_result === "ACCEPTED" && document.transport_status === "COMPLETED" &&
                    <div>
                      <button type="button" disabled={downloading}
                        onClick={() => { void exportDocument(document.document_id, "PDF"); }}>Descargar PDF (Sandbox)</button>
                      <button type="button" disabled={downloading}
                        onClick={() => { void exportDocument(document.document_id, "XML"); }}>Descargar XML (Sandbox)</button>
                    </div>}
                  {download?.id === document.document_id &&
                    <p role={download.error ? "alert" : "status"} style={{ overflowWrap: "anywhere" }}>{download.text}</p>}
                </li>
              ))}
            </ul>
          )}
          {history.has_more && <p>Se muestran los 20 documentos guardados más recientes.</p>}
        </section>
      )}
      <button type="button" data-testid="issue-sale-customer-button"
        disabled={fiscal.busy || blocked || saleId.trim() === ""}
        onClick={()=>void fiscal.issue(saleId.trim(),"SALES_INVOICE",{kind:"SALE_CUSTOMER"})}>
        Emitir con cliente de la venta
      </button>
      <p>Se usa el cliente guardado al crear la venta. Para ventas anteriores sin cliente, selecciona un adquiriente registrado.</p>
      <input
        data-testid="fiscal-customer-id-input"
        aria-label="ID del adquiriente registrado"
        value={customerId}
        onChange={(e) => { setCustomerId(e.target.value); }}
        placeholder="ID del adquiriente registrado"
        disabled={fiscal.busy}
      />

      <button
        data-testid="issue-identified-button"
        onClick={() => {
          void fiscal.issue(saleId.trim(), "SALES_INVOICE", {
            kind: "IDENTIFIED", customerId: customerId.trim(),
          });
        }}
        disabled={fiscal.busy || blocked || saleId.trim() === "" || customerId.trim() === ""}
      >
        Emitir con adquiriente
      </button>

      {/* Venta de mostrador sin identificar. Se ofrece porque es el caso
          mayoritario de un POS y el operador tiene que poder intentarlo y ver
          por qué no se puede, en vez de suponer que el botón no existe. */}
      <button
        data-testid="issue-anonymous-button"
        onClick={() => {
          void fiscal.issue(saleId.trim(), "SALES_INVOICE", {
            kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE",
          });
        }}
        disabled={fiscal.busy || blocked || saleId.trim() === ""}
      >
        Emitir sin identificar
      </button>

      {issued !== null && (issued.outcome === "ISSUED" || issued.outcome === "ALREADY_ISSUED") && (
        <div data-testid="fiscal-issued">
          <span data-testid="fiscal-issued-outcome">{issued.outcome}</span>
          <span data-testid="fiscal-issued-cufe">{issued.cufe}</span>
          <span data-testid="fiscal-issued-number">{issued.issued_number}</span>
        </div>
      )}

      {issued?.outcome === "FISCAL_REJECTED" && <div data-testid="fiscal-rejected" role="alert">
        <strong>Documento rechazado por el proveedor fiscal</strong>
        <p>El envío terminó, pero el documento no fue aceptado. Revisa el rechazo antes de corregirlo; no se volverá a emitir automáticamente.</p>
      </div>}
      {issued !== null && issued.outcome === "BLOCKED" && (
        <div data-testid="fiscal-blocked">
          <span data-testid="fiscal-blocked-code">{issued.block_code}</span>
          {issued.reasons.map((reason, index) => (
            <span key={`${String(index)}`} data-testid="fiscal-blocked-reason">
              {JSON.stringify(reason)}
            </span>
          ))}
        </div>
      )}

      {/*
        Los tres desenlaces que no son ni éxito ni bloqueo previo. `UNCERTAIN` y
        `REQUIRES_RECONCILIATION` se nombran aparte a propósito: el documento
        **pudo haberse emitido** y volver a intentarlo duplicaría la factura ante
        la DIAN. La pantalla no ofrece un botón de reintento para ellos.
      */}
      {issued !== null && (
        issued.outcome === "UNCERTAIN"
        || issued.outcome === "REQUIRES_RECONCILIATION"
      ) && (
        <div data-testid="fiscal-uncertain">
          <span data-testid="fiscal-uncertain-outcome">{issued.outcome}</span>
          <span data-testid="fiscal-uncertain-status">{issued.transport_status}</span>
        </div>
      )}

      {issued !== null && (issued.outcome === "TRANSPORT_FAILED" || issued.outcome === "NOT_ELIGIBLE") && (
        <div data-testid="fiscal-retriable">
          <span data-testid="fiscal-retriable-outcome">{issued.outcome}</span>
        </div>
      )}

      <button
        type="button"
        data-testid="sync-numbering-button"
        disabled={fiscal.busy}
        onClick={() => { void fiscal.syncNumbering(); }}
      >
        Sincronizar rangos de numeración
      </button>
      {fiscal.numberingSync !== null && (
        <div data-testid="fiscal-numbering-sync">
          <span data-testid="fiscal-numbering-outcome">{fiscal.numberingSync.outcome}</span>
          {fiscal.numberingSync.count !== null && (
            <span data-testid="fiscal-numbering-count">{fiscal.numberingSync.count}</span>
          )}
        </div>
      )}

      <button
        type="button"
        data-testid="issue-credit-note-button"
        disabled={fiscal.busy || fiscal.isBlocked(saleId.trim(), "CREDIT_NOTE") || saleId.trim() === ""}
        onClick={() => {
          void fiscal.issue(saleId.trim(), "CREDIT_NOTE", { kind: "SALE_CUSTOMER" });
        }}
      >
        Emitir nota crédito (factura aceptada de la venta)
      </button>

      {blocked && <p role="alert">Esta venta no admite otra emisión desde esta pantalla. Revisa el resultado y resuelve el rechazo o la conciliación con el proveedor; no hay corrección ni conciliación automática.</p>}
      {fiscal.resultSaleId === saleId.trim() && fiscal.error !== null && <div data-testid="fiscal-error">{fiscal.error}</div>}
    </section>
  );
}
