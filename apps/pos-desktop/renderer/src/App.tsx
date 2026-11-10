import { CanonicalPermission } from "@pos-platform/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import "./commercial-precision.css";
import { StatusPanel } from "./components/StatusPanel.js";
import { LocalOperatorLoginPanel } from "./components/LocalOperatorLoginPanel.js";
import { LocalOperatorSessionControl } from "./components/LocalOperatorSessionControl.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { TransferReviewPanel } from "./components/TransferReviewPanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { HardwarePanel } from "./components/HardwarePanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { AdministrativeControlPanel } from "./components/AdministrativeControlPanel.js";
import { useAuthorizationCapabilities } from "./hooks/useAuthorizationCapabilities.js";
import { useLocalOperatorSession } from "./hooks/useLocalOperatorSession.js";
import { orderScreensByRole } from "./roleNavigation.js";

function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

type Screen = {
  id: string;
  label: string;
  section: "Operación" | "Catálogo e inventario" | "Administración" | "Plataforma";
  render: () => React.JSX.Element;
};

export function App(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const localSession = useLocalOperatorSession(sessionEpoch);
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  const [visitedScreens, setVisitedScreens] = useState<ReadonlySet<string>>(new Set());
  const [receiptTarget, setReceiptTarget] = useState<string | null>(null);
  const [fiscalTarget, setFiscalTarget] = useState<string | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<string | null>(null);

  const refreshAccess = useCallback((): void => {
    setSessionEpoch((value) => value + 1);
    authorization.retry();
  }, [authorization.retry]);

  const navigateTo = useCallback((id: string, from: string | null): void => {
    setVisitedScreens((visited) => new Set([...visited, ...(from === null ? [] : [from]), id]));
    setActiveScreen(id);
  }, []);

  useEffect(() => {
    if (authorization.phase !== "ready") {
      setActiveScreen(null);
      setVisitedScreens(new Set());
      setReceiptTarget(null);
      setFiscalTarget(null);
      setInventoryTarget(null);
    }
  }, [authorization.phase]);

  useEffect(() => {
    setActiveScreen(null);
    setVisitedScreens(new Set());
  }, [localSession.username, localSession.role]);

  const screens = useMemo<Screen[]>(() => {
    if (authorization.phase !== "ready" || !localSession.ready) return [];

    const { permissions } = authorization;
    const result: Screen[] = [];

    if (permissions.has(CanonicalPermission.SALES_SALE_CREATE)) {
      result.push({
        id: "sales",
        label: "Caja y ventas",
        section: "Operación",
        render: () => <SalePanel permissions={permissions}
          onReceipt={permissions.has(CanonicalPermission.SALES_RECEIPT_READ) ? (id) => { setReceiptTarget(id); navigateTo("receipts", "sales"); } : undefined}
          onInvoice={permissions.has(CanonicalPermission.FISCAL_DOCUMENT_ISSUE) ? (id) => { setFiscalTarget(id); navigateTo("fiscal", "sales"); } : undefined} />,
      });
    }

    if (permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ) && hasAny(permissions, [
      CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM, CanonicalPermission.PAYMENTS_PAYMENT_CANCEL,
    ])) {
      result.push({ id: "payment-review", label: "Revisar transferencias", section: "Administración",
        render: () => <TransferReviewPanel permissions={permissions} /> });
    }

    if (permissions.has(CanonicalPermission.FISCAL_DOCUMENT_ISSUE)) {
      result.push({
        id: "fiscal",
        label: "Facturación electrónica",
        section: "Operación",
        render: () => <FiscalPanel initialSaleId={fiscalTarget} />,
      });
    }

    if (hasAny(permissions, [CanonicalPermission.CATALOG_PRODUCT_READ, CanonicalPermission.CATALOG_PRODUCT_REGISTER])) {
      result.push({
        id: "catalog",
        label: "Catálogo",
        section: "Catálogo e inventario",
        render: () => <CatalogPanel permissions={permissions}
          onReceiveStock={permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) ? (id) => { setInventoryTarget(id); navigateTo("inventory", "catalog"); } : undefined} />,
      });
    }

    if (hasAny(permissions, [
      CanonicalPermission.INVENTORY_STOCK_READ,
      CanonicalPermission.INVENTORY_STOCK_RECEIVE,
      CanonicalPermission.INVENTORY_STOCK_ADJUST,
    ])) {
      result.push({
        id: "inventory",
        label: "Inventario",
        section: "Catálogo e inventario",
        render: () => <InventoryPanel permissions={permissions} initialPresentationId={inventoryTarget} />,
      });
    }

    if (hasAny(permissions, [
      CanonicalPermission.CUSTOMERS_CUSTOMER_READ,
      CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER,
    ])) {
      result.push({
        id: "customers",
        label: "Clientes",
        section: "Operación",
        render: () => <CustomerPanel permissions={permissions} />,
      });
    }

    if (permissions.has(CanonicalPermission.SALES_RECEIPT_READ)) {
      result.push({
        id: "receipts",
        label: "Comprobantes",
        section: "Operación",
        render: () => <ReceiptPanel initialSaleId={receiptTarget} />,
      });
    }

    if (permissions.has(CanonicalPermission.HARDWARE_READ)) {
      result.push({ id: "hardware", label: "Impresora y cajón", section: "Administración", render: () => <HardwarePanel /> });
    }

    if (permissions.has(CanonicalPermission.AUDIT_EVENT_READ)) {
      result.push({
        id: "dashboard",
        label: "Dashboard",
        section: "Administración",
        render: () => <AdministrativeControlPanel kind="admin" />,
      }, {
        id: "admin-audit",
        label: "Auditoría administrativa",
        section: "Plataforma",
        render: () => <AdministrativeControlPanel kind="audit" />,
      });
    }

    return orderScreensByRole(result, localSession.role);
  }, [authorization, receiptTarget, fiscalTarget, inventoryTarget, navigateTo, localSession.role, localSession.ready]);

  if (authorization.phase !== "ready" || !localSession.ready) {
    const loading = authorization.phase === "loading" || (authorization.phase === "ready" && !localSession.ready);
    const unauthenticated = authorization.phase === "unauthenticated";
    return (
      <main className="pos-entry" aria-busy={loading}>
        <section className="pos-entry-brand" aria-label="Camacho POS Colombia">
          <div className="pos-entry-logo" role="img" aria-label="Camacho POS Colombia" />
        </section>
        <section className="pos-entry-card" aria-label="Estado de acceso">
          <span className="pos-entry-eyebrow">CAMACHO POS COLOMBIA</span>
          <h1>Camacho POS Colombia</h1>
          <h2>{loading ? "Validando sesión" : unauthenticated ? "Ingresar al POS" : authorization.phase === "denied" ? "Acceso denegado" : authorization.phase === "expired" ? "Sesión expirada" : "Acceso no disponible"}</h2>
          <p>{loading ? "Comprobando la sesión y los permisos efectivos." : unauthenticated ? "Identifícate para acceder a las funciones locales autorizadas de tu perfil." : "El POS no ha podido verificar una sesión autorizada."}</p>
          {loading ? (
            <div data-testid="authorization-loading" role="status">Cargando permisos…</div>
          ) : unauthenticated ? (
            <div data-testid="authorization-unauthenticated" role="status">No hay una sesión iniciada en este dispositivo.</div>
          ) : authorization.phase === "denied" ? (
            <div data-testid="authorization-denied" role="alert">La sesión no dispone de permisos efectivos para operar en este POS.</div>
          ) : authorization.phase === "expired" ? (
            <div data-testid="authorization-expired" role="alert">La verificación del backend indica que la sesión expiró. Es necesario autenticarse de nuevo.</div>
          ) : authorization.phase === "error" ? (
            <div data-testid="authorization-error" role="alert">
              No se pudo cargar la autorización: {authorization.message}
            </div>
          ) : null}
          {unauthenticated && <LocalOperatorLoginPanel onAuthenticated={refreshAccess} />}
          <button type="button" onClick={refreshAccess} disabled={loading}>Actualizar acceso</button>
          <StatusPanel />
        </section>
      </main>
    );
  }

  const selectedScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0] ?? null;

  return (
    <main
      className="pos-shell"
      data-visual-area={selectedScreen?.section === "Plataforma" ? "platform" : selectedScreen?.section === "Administración" ? "administration" : "operation"}
      data-operator-role={localSession.role ?? "none"}
    >
      <aside className="pos-sidebar" aria-label="Navegación principal">
        <a className="pos-skip-link" href="#pos-workspace">Saltar al área de trabajo</a>
        <div className="pos-brand-mark" role="img" aria-label="Camacho POS Colombia" />
        <p className="pos-brand-name">Camacho POS Colombia</p>
        <p className="pos-subtitle">{localSession.role === "CAJERO" ? "Caja" : localSession.role === "SUPERVISOR" ? "Supervisión" : localSession.role === "ADMINISTRADOR" ? "Administración" : localSession.role === "SUPERADMINISTRADOR" ? "Plataforma" : "Mi negocio"}</p>
        <nav className="pos-nav">
          {(["Operación", "Catálogo e inventario", "Administración", "Plataforma"] as const).map((section) => {
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
                    onClick={() => navigateTo(screen.id, selectedScreen?.id ?? null)}
                  >
                    {screen.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="pos-content" id="pos-workspace" tabIndex={-1}>
        <header className="pos-header">
          <div>
            <p className="pos-product-name">Camacho POS Colombia · {selectedScreen?.section ?? "Sesión autorizada"}</p>
            <h1>{selectedScreen?.label ?? "Sin acceso operativo"}</h1>
          </div>
          <LocalOperatorSessionControl onSessionChanged={refreshAccess}/>
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

        <details className="pos-operation" aria-label="Herramientas técnicas">
          <summary>Herramientas técnicas y diagnóstico</summary>
          <OperationPanel />
        </details>
      </div>
    </main>
  );
}

