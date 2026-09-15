import type {
  CredentialReference,
  FiscalDocumentType,
  FiscalEnvironment,
  FiscalProvider,
  NumberingRangePort,
  NumberingRangeSnapshot,
} from "@pos-platform/fiscal-adapters";
import type { DocumentScope, SqliteFiscalDocumentStore } from "./sqlite-fiscal-document-store.js";

/**
 * Sincroniza los rangos de numeración y los persiste (`DEC-021` F4).
 *
 * `NumberingRangePort.synchronizeRanges()` ya existe y está `SANDBOX_VERIFIED`
 * — se ejecutó contra `api-sandbox.factus.com.co` el 2026-09-06 y trajo rangos
 * reales. Lo que faltaba no era el puerto: era que alguien guardara lo que
 * devuelve. `fiscal_numbering_range` (`MIGRATION_016`) existía desde F1 sin
 * escritor.
 *
 * No decide **cuándo** sincronizar: eso es de quien orqueste el arranque o un
 * ciclo periódico, y no está decidido en este bloque. Esta pieza sólo sabe
 * hacerlo una vez, de forma correcta, cuando se le pide.
 */

export type SynchronizeRangesResult =
  | { readonly kind: "SYNCHRONIZED"; readonly count: number }
  | { readonly kind: "UNSUPPORTED"; readonly reasonCode: string }
  | { readonly kind: "UNAVAILABLE"; readonly reasonCode: string };

export class SynchronizeNumberingRangesUseCase {
  constructor(
    private readonly port: NumberingRangePort,
    private readonly store: SqliteFiscalDocumentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: DocumentScope,
    provider: FiscalProvider,
    environment: FiscalEnvironment,
    // El puerto pide un tipo documental por consulta; se sincronizan los que
    // el contrato canónico admite hoy con código DIAN verificado (`D-9`),
    // para no traer rangos que después nadie podría emitir.
    documentTypes: readonly FiscalDocumentType[],
    credential: CredentialReference,
    signal: AbortSignal,
  ): Promise<SynchronizeRangesResult> {
    const all = new Map<string, NumberingRangeSnapshot>();
    for (const documentType of documentTypes) {
      const outcome = await this.port.synchronizeRanges({ documentType, environment, credential }, signal);
      if (outcome.kind !== "SYNCHRONIZED") return outcome;
      // Varios tipos documentales pueden devolver el mismo `rangeId` si el
      // proveedor pagina por tipo pero el rango es compartido; se deduplica por
      // identidad, no se duplica en la tabla.
      for (const range of outcome.ranges) all.set(range.rangeId, range);
    }

    this.store.replaceRanges({
      scope, provider, environment,
      ranges: [...all.values()],
      synchronizedAt: this.now().toISOString(),
    });
    return { kind: "SYNCHRONIZED", count: all.size };
  }
}
