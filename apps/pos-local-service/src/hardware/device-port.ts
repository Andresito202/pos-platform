/**
 * Puerto común de periféricos — traducción del contrato escrito en
 * `docs/architecture/integration-contracts.md` §«POS Local Service ↔ hardware».
 *
 * No añade nada que ese contrato no diga. Lo que un dispositivo no sabe hacer
 * lo declara en `capabilities`, en vez de fingirlo: por eso `cancel` es
 * opcional —«el contrato no obliga a que todo dispositivo soporte
 * cancelación»—.
 *
 * Aislamiento (mismo documento): un adaptador no toca tablas de negocio, y el
 * servicio traduce sus resultados a resultados de aplicación. Nada de este
 * fichero importa SQLite ni casos de uso.
 */

export type DeviceKind =
  | "RECEIPT_PRINTER"
  | "CASH_DRAWER"
  | "BARCODE_SCANNER"
  | "SCALE"
  | "CUSTOMER_DISPLAY"
  | "PAYMENT_TERMINAL";

/**
 * Estados mínimos del contrato. `UNKNOWN` existe porque un periférico puede
 * haber recibido parte de un trabajo sin confirmarlo: en ese caso **no** se
 * sabe si imprimió, y decirlo es más seguro que adivinar.
 */
export type CommandStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "UNKNOWN";

export interface CommandResult<TResult = null> {
  readonly commandId: string;
  readonly deviceId: string;
  readonly status: CommandStatus;
  /** Estado del equipo observado durante el comando (`READY`, `PAPER_OUT`…). */
  readonly deviceStatus: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  /**
   * Si repetir **el mismo** comando es seguro. Nunca autoriza a repetir la
   * operación comercial que lo originó: «un timeout de impresión no autoriza
   * repetir una venta».
   */
  readonly retryable: boolean;
  readonly diagnosticCode: string | null;
  readonly result: TResult;
}

export interface DeviceHealth {
  readonly deviceStatus: string;
  readonly checkedAt: Date;
  readonly diagnosticCode: string | null;
}

/** Diagnóstico seguro: nunca credenciales ni contenido de trabajos. */
export interface DeviceDiagnostics {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly deviceKind: DeviceKind;
  readonly connection: string;
  readonly capabilities: readonly string[];
  readonly lastResult: Pick<CommandResult<unknown>, "commandId" | "status" | "diagnosticCode" | "finishedAt"> | null;
}

export interface DeviceAdapter<TCommand extends { readonly commandId: string }, TResult = null> {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly deviceId: string;
  readonly deviceKind: DeviceKind;
  readonly capabilities: readonly string[];
  health(): Promise<DeviceHealth>;
  execute(command: TCommand): Promise<CommandResult<TResult>>;
  cancel?(commandId: string): Promise<CommandResult<TResult>>;
  diagnostics(): Promise<DeviceDiagnostics>;
}
