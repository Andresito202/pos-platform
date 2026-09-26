import { useState } from "react";
import {
  CATALOG_IMPORT_TEMPLATE_HEADER,
  parseCatalogFile,
  type ParseResult,
} from "../catalog-import.js";
import { useCatalogImport } from "../hooks/useCatalogImport.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Carga inicial del catálogo — por donde entra la mercancía.
 *
 * ## Por qué es la pantalla que más importa para estrenar un POS
 *
 * Sin ella, cargar un minimercado eran diez o quince mil capturas de una en
 * una, y la hacía quien instalaba, no el comerciante. Con ella, el comerciante
 * exporta su hoja de Excel —o la copia y la pega— y el POS queda cargado.
 *
 * ## Dos pasos, a propósito: revisar y después cargar
 *
 * Revisar no envía nada. Dice cuántas líneas están listas y cuáles tienen un
 * problema, **con el número de línea de la hoja**, para que el comerciante
 * corrija antes de tocar su inventario. Cargar en un solo clic lo que no se
 * ha visto es la forma de descubrir tres mil precios mal escritos después de
 * haberlos vendido.
 *
 * Se permite cargar aunque haya líneas con error: se omiten y se dice
 * cuántas. Una línea mala no puede bloquear a las buenas, igual que dentro
 * del servicio.
 */
export function CatalogImportPanel(): React.JSX.Element {
  const loader = useCatalogImport();
  const [text, setText] = useState("");
  const [review, setReview] = useState<ParseResult | null>(null);
  const [businessDate, setBusinessDate] = useState(today());

  const readFile = (file: File | undefined): void => {
    if (file === undefined) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setReview(null);
    };
    reader.readAsText(file, "utf-8");
  };

  const ready = review?.rows.length ?? 0;
  const withErrors = new Set(review?.errors.map((error) => error.line) ?? []).size;

  return (
    <section className="card" data-testid="catalog-import-panel">
      <h2>Carga inicial del catálogo</h2>

      <p>
        Exporte su hoja como CSV, o copie las celdas y péguelas aquí. La primera
        fila debe ser la cabecera; el orden de las columnas no importa.
      </p>
      <code data-testid="catalog-import-template">{CATALOG_IMPORT_TEMPLATE_HEADER}</code>
      <p>
        Obligatorias: codigo, nombre, presentacion, unidad, decimales, precio.
        Sin <em>existencia_inicial</em> el artículo queda creado y sin mercancía.
        Sin los cinco códigos DIAN se vende y <strong>no se factura</strong>.
      </p>

      <input
        data-testid="catalog-import-file"
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        onChange={(e) => { readFile(e.target.files?.[0]); }}
        disabled={loader.busy}
      />
      <textarea
        data-testid="catalog-import-text"
        value={text}
        onChange={(e) => { setText(e.target.value); setReview(null); }}
        placeholder="…o pegue aquí las celdas copiadas de Excel"
        rows={8}
        disabled={loader.busy}
      />
      <input
        data-testid="catalog-import-business-date"
        value={businessDate}
        onChange={(e) => { setBusinessDate(e.target.value); }}
        placeholder="Fecha de negocio"
        disabled={loader.busy}
      />

      <button
        data-testid="catalog-import-review"
        onClick={() => { setReview(parseCatalogFile(text)); }}
        disabled={loader.busy || text.trim() === ""}
      >
        Revisar
      </button>

      {review !== null && (
        <div data-testid="catalog-import-review-result">
          <p data-testid="catalog-import-ready">{`${String(ready)} línea(s) lista(s)`}</p>
          {withErrors > 0 && (
            <>
              <p data-testid="catalog-import-error-count">
                {`${String(withErrors)} línea(s) con error — se omiten al cargar`}
              </p>
              <ul data-testid="catalog-import-errors">
                {review.errors.map((error, i) => (
                  <li key={i}>{`Línea ${String(error.line)}: ${error.problem}`}</li>
                ))}
              </ul>
            </>
          )}
          <button
            data-testid="catalog-import-submit"
            onClick={() => { void loader.importRows(review.rows, businessDate); }}
            disabled={loader.busy || ready === 0}
          >
            {`Cargar ${String(ready)} artículo(s)`}
          </button>
        </div>
      )}

      {loader.progress !== null && (
        <p data-testid="catalog-import-progress">
          {`Lote ${String(loader.progress.sent)} de ${String(loader.progress.total)}`}
        </p>
      )}
      {loader.progress !== null && !loader.busy && (
        <div data-testid="catalog-import-outcome">
          <p data-testid="catalog-import-imported">{`${String(loader.imported)} cargado(s)`}</p>
          {loader.rejected.length > 0 && (
            <ul data-testid="catalog-import-rejected">
              {loader.rejected.map((row, i) => (
                <li key={i}>{`Línea ${String(row.line)} (${row.code}): ${row.outcome}`}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {loader.error !== null && <p data-testid="catalog-import-error">{loader.error}</p>}
    </section>
  );
}
