import { useEffect, useState } from "react";
import type { CashDrawerReason } from "@pos-platform/contracts";
import { useCommercialSale } from "../hooks/useCommercialSale.js";
import { useCashDrawer, type DrawerOutcome } from "../hooks/useCashDrawer.js";
import { readScannedCode } from "../barcode-scan.js";
import { shouldPlayChime } from "../confirmation-sound.js";

const DRAWER_REASONS: readonly { value: CashDrawerReason; label: string }[] = [
  { value: "DAR_CAMBIO", label: "Dar cambio" },
  { value: "ARQUEO", label: "Arqueo" },
  { value: "CORRECCION_ENTREGA", label: "Corregir una entrega" },
  { value: "OTRO", label: "Otro (escriba el motivo)" },
];

/** Lo que el cajero lee de cada desenlace. «Abierto» es «el pulso llegó»: sin sensor no se sabe más. */
const DRAWER_MESSAGES: Record<DrawerOutcome, string> = {
  OPENED: "Pulso enviado al cajón.",
  OPEN_FAILED: "El cajón no recibió el pulso. Revise la impresora y vuelva a intentarlo.",
  OPEN_REJECTED: "La impresora respondió algo que no se entiende. Avise a soporte.",
  OPEN_UNCERTAIN: "No se sabe si el cajón recibió el pulso. Mírelo antes de pedir otro.",
  ALREADY_OPENED: "Este cobro ya abrió el cajón.",
  IN_PROGRESS: "El cajón se está abriendo.",
  NOT_ELIGIBLE: "Ese cobro no abre el cajón.",
  NOT_CONFIGURED: "Este equipo no tiene cajón configurado.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos.",
  UNAUTHORIZED: "No tiene permiso para abrir el cajón a mano.",
};

/**
 * La primera superficie comercial alcanzable: abrir caja, buscar por código de
 * barras, armar la venta, crearla y cobrarla en efectivo.
 *
 * Funcional antes que bonita. Lo que no puede fallar es la semántica: el total
 * mostrado es el que emitió el servicio, y la confirmación sonora la decide
 * `shouldPlayChime`, no esta vista.
 */
export function SalePanel(): React.JSX.Element {
  const sale = useCommercialSale();
  const [registerId, setRegisterId] = useState("");
  const [opening, setOpening] = useState("0.000000");
  const [barcode, setBarcode] = useState("");
  const [invalidScan, setInvalidScan] = useState<string | null>(null);
  const drawer = useCashDrawer();
  const [drawerReason, setDrawerReason] = useState<CashDrawerReason>("DAR_CAMBIO");
  const [drawerText, setDrawerText] = useState("");

  // Apertura automática (`D-46`): el mismo predicado que decide el sonido de
  // confirmación —cobro `CONFIRMED` que completó la venta—. El servicio lo
  // vuelve a comprobar contra el cobro; la clave derivada del cobro hace que
  // una segunda ejecución de este efecto sea una repetición, no otro pulso.
  const payment = sale.payment;
  useEffect(() => {
    if (payment !== null && shouldPlayChime(payment) && payment.payment_id !== null) {
      void drawer.openAfterCashPayment(payment.payment_id);
    }
  }, [payment]);
  const [quantity, setQuantity] = useState("1.000000");
  const [counted, setCounted] = useState("");
  const [saleCustomerId, setSaleCustomerId] = useState("");
  const [tendered, setTendered] = useState("");

  return (
    <section className="card" data-testid="sale-panel">
      <h2>Caja</h2>
      {sale.shift === null ? (
        <div data-testid="shift-closed">
          <input
            data-testid="cash-register-input"
            value={registerId}
            onChange={(e) => { setRegisterId(e.target.value); }}
            placeholder="ID de la caja"
            disabled={sale.busy}
          />
          <input
            data-testid="opening-amount-input"
            value={opening}
            onChange={(e) => { setOpening(e.target.value); }}
            placeholder="Base inicial"
            disabled={sale.busy}
          />
          <button
            data-testid="open-shift-button"
            onClick={() => { void sale.openShift(registerId.trim(), opening.trim()); }}
            disabled={sale.busy || registerId.trim() === ""}
          >
            Abrir turno
          </button>
        </div>
      ) : (
        <div data-testid="shift-open">
          Turno abierto · caja <span data-testid="shift-register">{sale.shift.cashRegisterId}</span>
          {/* Cerrar el turno es lo que permite abrir el siguiente: `DEC-012`
              §25.2 admite un único turno OPEN o CLOSING por caja, así que sin
              cierre la caja queda inservible al día siguiente. */}
          <input
            data-testid="counted-amount-input"
            value={counted}
            onChange={(e) => { setCounted(e.target.value); }}
            placeholder="Efectivo contado"
            disabled={sale.busy}
          />
          <button
            data-testid="close-shift-button"
            onClick={() => { void sale.closeShift(counted.trim()); }}
            disabled={sale.busy || counted.trim() === ""}
          >
            Cerrar turno
          </button>
          {/* Apertura manual: permiso `CASH_DRAWER_OPEN_MANUAL` (OWNER y
              GENERAL_ADMIN) y motivo del catálogo. El servicio audita antes
              del pulso; esta vista no decide quién puede. */}
          <div data-testid="drawer-manual">
            <select
              data-testid="drawer-reason-select"
              value={drawerReason}
              onChange={(e) => { setDrawerReason(e.target.value as CashDrawerReason); }}
              disabled={drawer.busy}
            >
              {DRAWER_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
            {drawerReason === "OTRO" && (
              <input
                data-testid="drawer-reason-text"
                value={drawerText}
                onChange={(e) => { setDrawerText(e.target.value); }}
                placeholder="Motivo"
                maxLength={200}
                disabled={drawer.busy}
              />
            )}
            <button
              data-testid="drawer-open-button"
              onClick={() => { void drawer.openManually(drawerReason, drawerText.trim() === "" ? null : drawerText.trim()); }}
              disabled={drawer.busy || (drawerReason === "OTRO" && drawerText.trim() === "")}
            >
              Abrir cajón
            </button>
          </div>
        </div>
      )}

      {drawer.outcome !== null && (
        <div data-testid="drawer-outcome" data-outcome={drawer.outcome}>
          {DRAWER_MESSAGES[drawer.outcome]}
          {drawer.diagnosticCode !== null && <> · {drawer.diagnosticCode}</>}
        </div>
      )}

      <h2>Producto</h2>
      {/* Un lector USB escribe el código y envía Enter (`HW-SCN-001`): el
          formulario convierte ese Enter en la búsqueda. El campo **no** se
          deshabilita mientras se busca, porque perdería el foco y la lectura
          siguiente se escribiría en ningún sitio; se vacía tras cada lectura
          para que dos códigos no se concatenen. */}
      <form
        data-testid="barcode-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (sale.busy) return;
          const scan = readScannedCode(barcode);
          if (scan.kind === "EMPTY") return;
          if (scan.kind === "INVALID") {
            setInvalidScan(scan.code);
            return;
          }
          setInvalidScan(null);
          setBarcode("");
          void sale.findItem(scan.code);
        }}
      >
        <input
          data-testid="barcode-input"
          value={barcode}
          onChange={(e) => { setBarcode(e.target.value); }}
          placeholder="Código de barras"
          autoComplete="off"
        />
        <button
          type="submit"
          data-testid="find-item-button"
          disabled={sale.busy || barcode.trim() === ""}
        >
          Buscar
        </button>
      </form>
      {invalidScan !== null && (
        <div data-testid="barcode-invalid">
          Código no válido: «{invalidScan}». Debe tener de 4 a 64 letras, números o guiones.
        </div>
      )}
      {sale.foundItem !== null && (
        <div data-testid="found-item">
          <span data-testid="found-item-name">{sale.foundItem.name}</span>
          {" · "}
          <span data-testid="found-item-price">{sale.foundItem.price_amount ?? "sin precio"}</span>
          <input
            data-testid="quantity-input"
            value={quantity}
            onChange={(e) => { setQuantity(e.target.value); }}
            disabled={sale.busy}
          />
          <button
            data-testid="add-item-button"
            onClick={() => { sale.addFoundItem(quantity.trim()); }}
            disabled={sale.busy || sale.foundItem.price_amount === null}
          >
            Agregar
          </button>
        </div>
      )}

      <h2>Venta</h2>
      <ul data-testid="cart">
        {sale.lines.map((line, index) => (
          <li key={`${line.presentationId}-${String(index)}`} data-testid="cart-line">
            {line.name} · {line.presentationName} · {line.quantity} × {line.priceAmount}
          </li>
        ))}
      </ul>
      {/* El adquiriente se nombra **al crear la venta** o no se nombra nunca:
          una venta ya creada no lo admite después, y sin él no puede fiarse
          (`CUSTOMER_REQUIRED`). Vacío para la venta de mostrador, que es la
          mayoría. */}
      <input
        data-testid="sale-customer-id-input"
        value={saleCustomerId}
        onChange={(e) => { setSaleCustomerId(e.target.value); }}
        placeholder="ID del adquiriente (opcional, obligatorio para fiar)"
        disabled={sale.busy || sale.sale !== null}
      />
      <button
        data-testid="create-sale-button"
        onClick={() => { void sale.createSale(saleCustomerId); }}
        disabled={sale.busy || sale.lines.length === 0 || sale.sale !== null}
      >
        Crear venta
      </button>

      {sale.sale !== null && (
        <div data-testid="sale-created">
          Total a pagar: <span data-testid="payable-amount">{sale.sale.payableAmount}</span>
          {/* El identificador se muestra porque el cajero lo necesita para pedir
              el recibo: el cliente vuelve con una duda y hay que recuperarla. */}
          {" · venta "}<span data-testid="sale-id">{sale.sale.saleId}</span>
          {/* Lo que el cliente entrega. Vacío significa «el importe justo»,
              que es lo que ocurría siempre antes de existir este campo: el
              cambio salía cero en toda venta en efectivo. */}
          <input
            data-testid="tendered-amount-input"
            value={tendered}
            onChange={(e) => { setTendered(e.target.value); }}
            placeholder="Efectivo recibido (vacío = importe justo)"
            disabled={sale.busy}
          />
          <button
            data-testid="charge-cash-button"
            onClick={() => { void sale.chargeCash(tendered); }}
            disabled={sale.busy}
          >
            Cobrar en efectivo
          </button>
          {/* Reportar la transferencia y atestiguarla son dos actos distintos,
              con dos permisos distintos (`UC-PAY-002` y `UC-PAY-003`). La
              pantalla no los funde en un botón: el cajero recibe el comprobante
              y alguien da el dinero por bueno, que no tiene por qué ser el
              mismo. */}
          <button
            data-testid="register-transfer-button"
            onClick={() => { void sale.registerTransfer(); }}
            disabled={sale.busy || sale.transfer !== null}
          >
            Transferencia
          </button>
        </div>
      )}

      {sale.payment !== null && (
        sale.payment.sale_completed ? (
          <div data-testid="sale-completed">
            Venta cobrada · cambio {sale.payment.change_amount ?? "0.000000"}
          </div>
        ) : (
          <div data-testid="payment-partial">
            Pago registrado ({sale.payment.outcome}) · cobertura{" "}
            <span data-testid="confirmed-coverage">{sale.payment.confirmed_coverage ?? "0.000000"}</span>
            {" "}· la venta aún no está cobrada
          </div>
        )
      )}

      {sale.transfer !== null && (
        <div data-testid="transfer-registered">
          Transferencia registrada · pago{" "}
          <span data-testid="transfer-payment-id">{sale.transfer.paymentId}</span>
          {" · estado "}
          <span data-testid="transfer-status">{sale.transfer.status}</span>
          {" · reportado "}
          <span data-testid="transfer-expected-amount">{sale.transfer.expectedAmount}</span>
          {/* Registrada NO es cobrada: mientras nadie atestigüe, la venta sigue
              sin completarse y no suena nada. */}
          <div data-testid="transfer-pending">Pendiente de confirmación</div>
          <button
            data-testid="confirm-transfer-button"
            onClick={() => { void sale.confirmTransfer(); }}
            disabled={sale.busy}
          >
            Confirmar transferencia
          </button>
        </div>
      )}

      {sale.transferConfirmation !== null && (
        sale.transferConfirmation.sale_completed ? (
          <div data-testid="transfer-sale-completed">
            Venta cobrada por transferencia · cobertura{" "}
            <span data-testid="transfer-confirmed-coverage">
              {sale.transferConfirmation.confirmed_coverage}
            </span>
          </div>
        ) : (
          <div data-testid="transfer-partial">
            Transferencia {sale.transferConfirmation.outcome} · la venta aún no está cobrada
          </div>
        )
      )}

      {sale.closedShift !== null && (
        sale.closedShift.outcome === "CLOSED" ? (
          <div data-testid="shift-close-result">
            Turno cerrado · esperado{" "}
            <span data-testid="shift-expected-cash">{sale.closedShift.expected_cash}</span>
            {" · contado "}
            <span data-testid="shift-counted-amount">{sale.closedShift.counted_amount}</span>
            {" · diferencia "}
            <strong data-testid="shift-difference">{sale.closedShift.difference_amount}</strong>
          </div>
        ) : (
          /* Un cierre rechazado no se disfraza: el código estable es la única
             pista accionable que tiene el cajero. */
          <div data-testid="shift-close-rejected">{sale.closedShift.outcome}</div>
        )
      )}

      {sale.error !== null && <div data-testid="sale-error">{sale.error}</div>}
      {/* Nueva venta es venta nueva **también de comprador**. Hallado el
          2026-09-26: el cliente quedaba en el campo, y tras una venta fiada
          todas las siguientes del día salían a su nombre —comprador falso en
          el recibo y en el rastro de un retiro—. */}
      <button
        data-testid="reset-button"
        onClick={() => { sale.reset(); setSaleCustomerId(""); }}
        disabled={sale.busy}
      >
        Nueva venta
      </button>
    </section>
  );
}
