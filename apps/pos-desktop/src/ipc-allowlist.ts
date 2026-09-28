export const IPC_ALLOWED_CHANNELS = [
  "pos:runtime.status.get",
  "pos:operation.result.get",
  "pos:operation.confirm",
  // Superficie comercial V1 — `DEC-014` §3.2. El prefijo `pos:` pertenece a
  // esta frontera; el servicio local usa los mismos nombres sin prefijo.
  // `runtime.handshake` sigue sin exponerse: es main ↔ servicio.
  "pos:session.activate",
  "pos:session.recover",
  // Login y salida del operador — `DEC-026` §13.11. La ventana entrega lo que
  // la persona teclea; el servicio prueba el equipo y activa la sesión.
  "pos:session.login",
  "pos:session.end",
  "pos:cash.shift.open",
  "pos:cash.shift.close",
  "pos:sale.create",
  // Payment V1 — `DEC-016`.
  "pos:payment.register.cash",
  "pos:payment.register.transfer",
  "pos:payment.transfer.confirm",
  "pos:payment.cancel",
  "pos:payment.get",
  // QR con proveedor — `DEC-016`. Se expone aunque este equipo no tenga
  // credencial: sin proveedor el servicio responde `PROVIDER_NOT_CONFIGURED`,
  // que es una negativa tipada. Ocultar el canal convertiría esa negativa en
  // «la operación no existe», que es peor diagnóstico para el cajero.
  "pos:payment.register.qr",
  // Crédito de cliente — `DEC-005`. El módulo estaba completo en el servicio
  // —caso de uso, handler, esquema y pruebas— y era inalcanzable desde el
  // producto porque estos cuatro canales nunca se añadieron aquí.
  "pos:payment.register.credit",
  "pos:credit.account.open",
  "pos:credit.account.get",
  "pos:credit.payment.register",
  "pos:customer.register",
  "pos:customer.get",
  "pos:customer.find",
  // Emisión fiscal — `DEC-021` F5.
  "pos:fiscal.document.issue",
  "pos:catalog.product.register",
  // D-19 — escritura de atributos fiscales de la presentación.
  "pos:catalog.fiscal.attribute.set",
  "pos:catalog.presentation.add",
  "pos:catalog.conversion.declare",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  "pos:catalog.item.import",
  // Inventario — `MIGRATION_015`.
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  // Abrir una paca y convertirla en unidades (`DEC-004` §1736).
  "pos:inventory.conversion.apply",
  "pos:inventory.stock.get",
  "pos:inventory.lot.receive",
  "pos:inventory.lot.list",
  // Rastro de lote: sólo lectura, para un retiro sanitario.
  "pos:inventory.lot.trace",
  // Lo que vence esta semana en toda la sucursal: sólo lectura.
  "pos:inventory.lot.expiring",
  // Documentos fiscales de una venta y a quién se facturaron: sólo lectura.
  "pos:fiscal.document.list",
  // Recibo — `DEC-019`. Sólo lectura: proyecta la venta ya cobrada.
  "pos:sales.receipt.get",
  // Impresión del recibo — `D-46`. Mutante: deja rastro en la cola y exige
  // clave de idempotencia; repetir la misma petición no imprime otro papel.
  "pos:sales.receipt.print",
  // Cajón — `D-46`. Mutante: la automática la comprueba el servicio contra el
  // cobro; la manual exige `CASH_DRAWER_OPEN_MANUAL` y queda auditada.
  "pos:cash.drawer.open",
  // Devolución — `B11`. Mutante: entrega efectivo y repone mercancía; exige
  // clave de idempotencia y los seis permisos de devolución y reembolso.
  "pos:sales.return.create",
  // Confirmación segregada de un reembolso de transferencia — `D-49`.
  // Mutante: exige idempotencia; el permiso y el cruce de actor los valida el
  // servicio, no el canal.
  "pos:payments.refund.confirm",
  // Flujo segregado de devolución — `D-50`: solicitar, aprobar y ejecutar son
  // tres operaciones distintas, cada una con su propio permiso e
  // idempotencia; el servicio exige el permiso de cada etapa, no el canal.
  "pos:sales.return.request",
  "pos:sales.return.approve",
  "pos:sales.return.execute",
] as const;

export type IpcAllowedChannel = (typeof IPC_ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is IpcAllowedChannel {
  return (IPC_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}
