import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";

/**
 * El orden sigue el de la jornada real, no el de la arquitectura: primero se
 * carga el catálogo y entra la mercancía, después se vende y se cobra, luego se
 * entrega el recibo. El adquiriente vive al lado porque se registra cuando el
 * cliente lo pide, no en un momento fijo, y la emisión fiscal va inmediatamente
 * después porque necesita las dos cosas: la venta cobrada y el adquiriente.
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
      <FiscalPanel />
      <OperationPanel />
    </main>
  );
}
