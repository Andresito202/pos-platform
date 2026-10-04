import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { useAuthorizationCapabilities } from "./hooks/useAuthorizationCapabilities.js";

/**
 * El orden sigue el de la jornada real, no el de la arquitectura: primero se
 * carga el catálogo y entra la mercancía, después se vende y se cobra, luego se
 * entrega el recibo. El adquiriente vive al lado porque se registra cuando el
 * cliente lo pide, no en un momento fijo, y la emisión fiscal va inmediatamente
 * después porque necesita las dos cosas: la venta cobrada y el adquiriente.
 */
function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

export function App(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();

  if (authorization.phase === "loading") {
    return (
      <main>
        <h1>POS Local</h1>
        <StatusPanel />
        <div data-testid="authorization-loading">Cargando permisos…</div>
      </main>
    );
  }

  if (authorization.phase === "error") {
    return (
      <main>
        <h1>POS Local</h1>
        <StatusPanel />
        <div data-testid="authorization-error">
          No se pudo cargar la autorización: {authorization.message}
        </div>
      </main>
    );
  }

  const { permissions } = authorization;
  const canSell = hasAny(permissions, [
    "CASH_SHIFT_OPEN",
    "CASH_SHIFT_CLOSE",
    "SALES_SALE_CREATE",
    "PAYMENTS_PAYMENT_REGISTER",
    "PAYMENTS_TRANSFER_REPORT",
    "PAYMENTS_TRANSFER_CONFIRM",
  ]);
  const canCatalog = hasAny(permissions, [
    "CATALOG_PRODUCT_READ",
    "CATALOG_PRODUCT_REGISTER",
  ]);
  const canInventory = hasAny(permissions, [
    "INVENTORY_STOCK_READ",
    "INVENTORY_STOCK_RECEIVE",
    "INVENTORY_STOCK_ADJUST",
  ]);
  const canCustomers = hasAny(permissions, [
    "CUSTOMERS_CUSTOMER_READ",
    "CUSTOMERS_CUSTOMER_REGISTER",
  ]);
  const canReceipts = permissions.has("SALES_RECEIPT_READ");

  return (
    <main>
      <h1>POS Local</h1>
      <StatusPanel />

      {canSell && (
        <section aria-labelledby="sales-section">
          <h2 id="sales-section">Caja y ventas</h2>
          <SalePanel />
        </section>
      )}

      {canCatalog && (
        <section aria-labelledby="catalog-section">
          <h2 id="catalog-section">Catálogo</h2>
          <CatalogPanel />
        </section>
      )}

      {canInventory && (
        <section aria-labelledby="inventory-section">
          <h2 id="inventory-section">Inventario</h2>
          <InventoryPanel />
        </section>
      )}

      {canCustomers && (
        <section aria-labelledby="customers-section">
          <h2 id="customers-section">Clientes</h2>
          <CustomerPanel />
        </section>
      )}

      {canReceipts && (
        <section aria-labelledby="receipts-section">
          <h2 id="receipts-section">Comprobantes</h2>
          <ReceiptPanel />
        </section>
      )}

      {canSell && <FiscalPanel />}
      <OperationPanel />
    </main>
  );
}
