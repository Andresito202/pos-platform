import { useCallback, useRef, useState } from "react";
import type { CatalogItemImportResult } from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { batches, type ParsedRow } from "../catalog-import.js";

/**
 * Envía el fichero ya leído, en lotes de 500, y traduce el resultado a las
 * líneas del fichero.
 *
 * ## La traducción que no puede faltar
 *
 * El servicio devuelve el `index` de cada fila rechazada **dentro de su lote**.
 * Para el comerciante, «fila 3 del lote 4» no significa nada: su hoja dice
 * línea 1.504. Cada fila enviada conserva la línea de la que salió, y aquí se
 * recupera. Sin esto, el resultado de una carga grande sería imposible de
 * corregir.
 *
 * ## Un lote que falla no detiene los demás
 *
 * Igual que una fila mala no descarta a las buenas dentro de un lote, un lote
 * rechazado entero —la sesión caducó a mitad, el canal se cortó— no borra lo
 * que ya entró. Se registra con sus líneas y se sigue: el comerciante
 * reimporta el fichero y lo ya cargado responde «ya existía», que no duplica
 * existencia porque la fila se detiene antes de llegar a ella.
 */

export interface ImportLineOutcome {
  readonly line: number;
  readonly code: string;
  readonly outcome: string;
}

export interface CatalogImportState {
  readonly busy: boolean;
  /** Lotes enviados sobre el total, para que una carga de 5.000 no parezca colgada. */
  readonly progress: { readonly sent: number; readonly total: number } | null;
  readonly imported: number;
  readonly rejected: readonly ImportLineOutcome[];
  readonly error: string | null;
}

export function useCatalogImport(): CatalogImportState & {
  importRows(rows: readonly ParsedRow[], businessDate: string): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CatalogImportState["progress"]>(null);
  const [imported, setImported] = useState(0);
  const [rejected, setRejected] = useState<readonly ImportLineOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Ver `useCommercialSale.ts`: cierra la ventana de doble clic que un
   * `busy` de estado, por sí solo, no cierra. */
  const inFlight = useRef(false);

  const importRows = useCallback(async (rows: readonly ParsedRow[], businessDate: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setImported(0);
    setRejected([]);

    const parts = batches(rows);
    setProgress({ sent: 0, total: parts.length });

    // Una clave por carga y un sufijo por lote: repetir el mismo intento no
    // duplica, y cada lote es una operación idempotente distinta.
    const attempt = newIdempotencyKey();
    let total = 0;
    const lost: ImportLineOutcome[] = [];

    try {
      for (const [n, part] of parts.entries()) {
        const response = await callCommercial<CatalogItemImportResult>(
          "catalog.item.import",
          {
            items: part.map((row) => row.item),
            business_date: businessDate,
            reason_code: "INITIAL_COUNT",
          },
          `${attempt}:${String(n)}`,
        );

        if (response.result === null || response.result.outcome !== "COMPLETED") {
          // El lote entero no entró: cada una de sus filas se reporta con su
          // línea, para que se vea exactamente qué hay que reintentar.
          //
          // Se reporta `result_code` y **no** `outcome`. Medido ejecutando la
          // pantalla contra el servicio: con la sesión sin vincular, `outcome`
          // decía `UNAUTHORIZED` —igual que si faltara un permiso— y el
          // `result_code` decía `SESSION_NOT_BOUND`. Son dos problemas con
          // remedios opuestos: uno se arregla recuperando la sesión, el otro
          // pidiéndole el permiso al propietario. Mostrar el primero haría
          // perseguir el equivocado.
          const code = response.result_code;
          for (const row of part) lost.push({ line: row.line, code: row.item.code, outcome: code });
        } else {
          total += response.result.imported;
          for (const row of response.result.rejected) {
            const source = part[row.index];
            lost.push({
              line: source?.line ?? -1,
              code: row.code,
              outcome: row.outcome,
            });
          }
        }
        setProgress({ sent: n + 1, total: parts.length });
        setImported(total);
        setRejected([...lost]);
      }
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, progress, imported, rejected, error, importRows };
}
