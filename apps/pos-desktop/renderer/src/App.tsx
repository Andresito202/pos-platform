import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { CreditPanel } from "./components/CreditPanel.js";

/**
 * El orden sigue el de la jornada real, no el de la arquitectura: primero se
 * carga el catálogo y entra la mercancía, después se vende y se cobra, luego se
 * entrega el recibo. El adquiriente vive al lado porque se registra cuando el
 * cliente lo pide, no en un momento fijo.
 *
 * El fiado va **después** del adquiriente porque lo presupone: `DEC-002` §159
 * exige que la venta nombre un adquiriente para poder fiarla, así que sin
 * cliente registrado no hay cuenta de crédito que abrir.
 */
export function App(): React.JSX.Element {
  return (
    <main>
      <h1>POS Local</h1>
      <StatusPanel />
      <CatalogPanel />
      <InventoryPanel />
      <SalePanel />
      <ReceiptPanel />
      <CustomerPanel />
      <CreditPanel />
      <OperationPanel />
    </main>
  );
}
