import { useCallback, useMemo, useState } from "react";
import "./App.css";
import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { useAuthorizationCapabilities } from "./hooks/useAuthorizationCapabilities.js";
import { orderScreensByRole } from "./roleNavigation.js";

function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

type Screen = {
  id: string;
  label: string;
  render: () => React.JSX.Element;
};

export function App(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  // Tip #106: keep visited screens mounted (hidden) so SalePanel shift/cart
  // state survives capability navigation. Unmounting on every nav wiped the open shift.
  const [visitedScreens, setVisitedScreens] = useState<ReadonlySet<string>>(new Set());

  const navigateTo = useCallback((id: string, from: string | null): void => {
    setVisitedScreens((visited) => new Set([...visited, ...(from === null ? [] : [from]), id]));
    setActiveScreen(id);
  }, []);

  const screens = useMemo<Screen[]>(() => {
    if (authorization.phase !== "ready") return [];

    const { permissions, entitlements } = authorization;
    const result: Screen[] = [];

    if (hasAny(permissions, [
      "CASH_SHIFT_OPEN",
      "CASH_SHIFT_CLOSE",
      "SALES_SALE_CREATE",
      "PAYMENTS_PAYMENT_REGISTER",
      "PAYMENTS_TRANSFER_REPORT",
      "PAYMENTS_TRANSFER_CONFIRM",
    ])) {
      result.push({
        id: "sales",
        label: "Caja y ventas",
        render: () => <SalePanel />,
      });
    }

    if (permissions.has("FISCAL_DOCUMENT_ISSUE")) {
      result.push({
        id: "fiscal",
        label: "Facturación electrónica",
        render: () => <FiscalPanel />,
      });
    }

    if (hasAny(permissions, ["CATALOG_PRODUCT_READ", "CATALOG_PRODUCT_REGISTER"])) {
      result.push({
        id: "catalog",
        label: "Catálogo",
        render: () => <CatalogPanel permissions={permissions} entitlements={entitlements} />,
      });
    }

    if (hasAny(permissions, [
      "INVENTORY_STOCK_READ",
      "INVENTORY_STOCK_RECEIVE",
      "INVENTORY_STOCK_ADJUST",
    ])) {
      result.push({
        id: "inventory",
        label: "Inventario",
        render: () => <InventoryPanel permissions={permissions} entitlements={entitlements} />,
      });
    }

    if (hasAny(permissions, [
      "CUSTOMERS_CUSTOMER_READ",
      "CUSTOMERS_CUSTOMER_REGISTER",
    ])) {
      result.push({
        id: "customers",
        label: "Clientes",
        render: () => <CustomerPanel />,
      });
    }

    if (permissions.has("SALES_RECEIPT_READ")) {
      result.push({
        id: "receipts",
        label: "Comprobantes",
        render: () => <ReceiptPanel />,
      });
    }

    // Tip hosts Pharmacy/Bakery/Transform inside Catalog/Inventory under SECTOR
    // entitlements. roleNavigation orders when a local role is known; without
    // commercial login this keeps the permission-gated list as-is.
    return orderScreensByRole(result, null);
  }, [authorization]);

  if (authorization.phase === "loading") {
    return (
      <main>
        <h1>Camacho POS Colombia</h1>
        <StatusPanel />
        <div data-testid="authorization-loading">Cargando permisos…</div>
      </main>
    );
  }

  if (authorization.phase === "error") {
    return (
      <main>
        <h1>Camacho POS Colombia</h1>
        <StatusPanel />
        <div data-testid="authorization-error">
          No se pudo cargar la autorización: {authorization.message}
        </div>
      </main>
    );
  }

  const selectedScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0] ?? null;

  return (
    <main className="pos-shell">
      <aside className="pos-sidebar" aria-label="Navegación principal">
        <div className="pos-brand-mark" role="img" aria-label="Camacho POS Colombia" />
        <p className="pos-brand-name">Camacho POS Colombia</p>
        <p className="pos-subtitle">Acceso según permisos efectivos</p>
        <nav className="pos-nav">
          {screens.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className="pos-nav-button"
              aria-current={selectedScreen?.id === screen.id ? "page" : undefined}
              onClick={() => { navigateTo(screen.id, selectedScreen?.id ?? null); }}
            >
              {screen.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="pos-content">
        <header className="pos-header">
          <div>
            <p className="pos-product-name">Camacho POS Colombia</p>
            <h1>{selectedScreen?.label ?? "Sin acceso operativo"}</h1>
            <p>Acceso disponible según la autorización efectiva de la sesión.</p>
          </div>
        </header>

        <section className="pos-status">
          <StatusPanel />
        </section>

        <section className="pos-screen" aria-label="Pantalla activa">
          {selectedScreen ? (
            screens.map((screen) => (
              <div key={screen.id} hidden={screen.id !== selectedScreen.id}>
                {(screen.id === selectedScreen.id || visitedScreens.has(screen.id)) && screen.render()}
              </div>
            ))
          ) : (
            <div data-testid="no-authorized-screens">
              No hay pantallas comerciales disponibles para los permisos de esta sesión.
            </div>
          )}
        </section>

        <section className="pos-operation" aria-label="Operación técnica">
          <OperationPanel />
        </section>
      </div>
    </main>
  );
}
