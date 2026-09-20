import { SessionPanel } from "./components/SessionPanel.js";
import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ProviderPaymentPanel } from "./components/ProviderPaymentPanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { CreditPanel } from "./components/CreditPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";

/**
 * El orden sigue el de la jornada real, no el de la arquitectura: primero se
 * carga el catálogo y entra la mercancía, después se vende y se cobra, luego se
 * entrega el recibo. El adquiriente vive al lado porque se registra cuando el
 * cliente lo pide, no en un momento fijo.
 *
 * La sesión va antes que todo, incluido el estado del servicio: sin vínculo de
 * sesión cada operación de abajo se rechaza con `SESSION_NOT_BOUND`, y ésa es
 * la primera pregunta que hay que poder responder al abrir el equipo.
 *
 * El QR va junto a la venta porque cobra una venta, pero después del efectivo
 * y la transferencia: es el medio que **no** se resuelve en el mostrador, y su
 * desenlace llega más tarde y por otra vía.
 *
 * El fiado va **después** del adquiriente porque lo presupone: `DEC-002` §159
 * exige que la venta nombre un adquiriente para poder fiarla, así que sin
 * cliente registrado no hay cuenta de crédito que abrir.
 *
 * La emisión fiscal va la última de la jornada porque necesita las dos cosas
 * que la preceden: la venta cobrada y el adquiriente (`DEC-021` F5).
 */
export function App(): React.JSX.Element {
  return (
    <main>
      <h1>POS Local</h1>
      <SessionPanel />
      <StatusPanel />
      <CatalogPanel />
      <InventoryPanel />
      <SalePanel />
      <ProviderPaymentPanel />
      <ReceiptPanel />
      <CustomerPanel />
      <CreditPanel />
      <FiscalPanel />
      <OperationPanel />
    </main>
  );
}
