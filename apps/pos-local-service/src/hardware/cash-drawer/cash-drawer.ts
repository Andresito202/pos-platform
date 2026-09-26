import * as z from "zod";
import type { CommandResult, DeviceAdapter, DeviceDiagnostics, DeviceHealth } from "../device-port.js";
import type { PrintJobCommand } from "../receipt-printer/tcp-raw-printer.js";

/**
 * Perfil del cajón (`docs/hardware/support-matrix.md` §Cajón: «pulso
 * configurable por perfil»). Conector y tiempos dependen del cajón y de la
 * impresora concretos; no hay valor por defecto de «modelo típico».
 *
 * `ESC p m t1 t2` expresa los tiempos en unidades de 2 ms (0–255), así que se
 * aceptan milisegundos pares entre 2 y 510, y un apagado no menor que el
 * encendido.
 */
export const CashDrawerProfileSchema = z.strictObject({
  connector_pin: z.union([z.literal(2), z.literal(5)]),
  pulse_on_ms: z.number().int().min(2).max(510).multipleOf(2),
  pulse_off_ms: z.number().int().min(2).max(510).multipleOf(2),
}).refine((profile) => profile.pulse_off_ms >= profile.pulse_on_ms, {
  message: "pulse_off_ms must be greater than or equal to pulse_on_ms",
  path: ["pulse_off_ms"],
});
export type CashDrawerProfile = z.infer<typeof CashDrawerProfileSchema>;

/** `ESC p m t1 t2`: m=0 conector pin 2, m=1 pin 5; t en unidades de 2 ms. */
export function drawerPulseBytes(profile: CashDrawerProfile): Uint8Array {
  return Uint8Array.of(0x1b, 0x70, profile.connector_pin === 2 ? 0 : 1, profile.pulse_on_ms / 2, profile.pulse_off_ms / 2);
}

export interface DrawerCommand {
  readonly commandId: string;
}

/**
 * Cajón conectado al puerto RJ11/RJ12 de la impresora (HW-DRW-001).
 *
 * **Sólo declara `OPEN_PULSE`.** Un cajón sin sensor no sabe si quedó abierto
 * o cerrado, y la matriz prohíbe simular esa lectura: `SUCCEEDED` significa
 * «el pulso llegó a la impresora», nunca «el cajón se abrió».
 *
 * No decide cuándo abrir. Quién puede pedirlo, con qué motivo y tras qué
 * cobros es política del servicio, que audita antes de llamar aquí
 * (`integration-contracts.md` §Aislamiento 5).
 */
export class PrinterConnectedCashDrawer implements DeviceAdapter<DrawerCommand> {
  readonly adapterId = "escpos-drawer-pulse";
  readonly adapterVersion = "1.0.0";
  readonly deviceKind = "CASH_DRAWER" as const;
  readonly capabilities = ["OPEN_PULSE"] as const;
  readonly deviceId: string;

  constructor(
    private readonly printer: DeviceAdapter<PrintJobCommand>,
    private readonly profile: CashDrawerProfile,
  ) {
    this.deviceId = `drawer@${printer.deviceId}`;
  }

  async health(): Promise<DeviceHealth> {
    return this.printer.health();
  }

  execute(command: DrawerCommand): Promise<CommandResult> {
    return this.printer.execute({ commandId: command.commandId, bytes: drawerPulseBytes(this.profile), requirePaper: false })
      .then((result) => ({ ...result, deviceId: this.deviceId }));
  }

  async diagnostics(): Promise<DeviceDiagnostics> {
    const printer = await this.printer.diagnostics();
    return { ...printer, adapterId: this.adapterId, adapterVersion: this.adapterVersion, deviceKind: this.deviceKind, capabilities: this.capabilities };
  }
}
