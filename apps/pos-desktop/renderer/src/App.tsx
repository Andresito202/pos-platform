import { useMemo, useState } from "react";
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

function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

type Screen = {
  id: string;
  label: string;
  section: "Operación" | "Catálogo e inventario";
  render: () => React.JSX.Element;
};

export function App(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();
  const [activeScreen, setActiveScreen] = useState<string | null>(null);

  const screens = useMemo<Screen[]>(() => {
    if (authorization.phase !== "ready") return [];

    const { permissions } = authorization;
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
        section: "Operación",
        render: () => <SalePanel />,
      });
    }

    if (permissions.has("FISCAL_DOCUMENT_ISSUE")) {
      result.push({
        id: "fiscal",
        label: "Facturación electrónica",
        section: "Operación",
        render: () => <FiscalPanel />,
      });
    }

    if (hasAny(permissions, ["CATALOG_PRODUCT_READ", "CATALOG_PRODUCT_REGISTER"])) {
      result.push({
        id: "catalog",
        label: "Catálogo",
        section: "Catálogo e inventario",
        render: () => <CatalogPanel />,
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
        section: "Catálogo e inventario",
        render: () => <InventoryPanel />,
      });
    }

    if (hasAny(permissions, [
      "CUSTOMERS_CUSTOMER_READ",
      "CUSTOMERS_CUSTOMER_REGISTER",
    ])) {
      result.push({
        id: "customers",
        label: "Clientes",
        section: "Operación",
        render: () => <CustomerPanel />,
      });
    }

    if (permissions.has("SALES_RECEIPT_READ")) {
      result.push({
        id: "receipts",
        label: "Comprobantes",
        section: "Operación",
        render: () => <ReceiptPanel />,
      });
    }

    return result;
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
          {(["Operación", "Catálogo e inventario"] as const).map((section) => {
            const sectionScreens = screens.filter((screen) => screen.section === section);
            if (sectionScreens.length === 0) return null;

            return (
              <div key={section} className="pos-nav-section">
                <p className="pos-nav-section-title">{section}</p>
                {sectionScreens.map((screen) => (
                  <button
                    key={screen.id}
                    type="button"
                    className="pos-nav-button"
                    aria-current={selectedScreen?.id === screen.id ? "page" : undefined}
                    onClick={() => { setActiveScreen(screen.id); }}
                  >
                    {screen.label}
                  </button>
                ))}
              </div>
            );
          })}
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
            selectedScreen.render()
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
