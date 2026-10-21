import { CanonicalPermission } from "@pos-platform/contracts";
import { useCallback, useMemo, useState } from "react";
import "./App.css";
import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { HardwarePanel } from "./components/HardwarePanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { AdministrativeControlPanel } from "./components/AdministrativeControlPanel.js";

type PlannedScreenDefinition = {
  id: string;
  label: string;
  section: "Administración" | "Plataforma";
  description: string;
  actions: readonly string[];
  requiredPermissions: readonly string[];
};

const plannedScreens: readonly PlannedScreenDefinition[] = [
  { id: "dashboard", label: "Dashboard", section: "Administración", description: "Resumen operativo, indicadores y alertas.", actions: ["Ver indicadores", "Ver alertas", "Actualizar resumen"], requiredPermissions: [CanonicalPermission.AUDIT_EVENT_READ] },
  { id: "reports", label: "Reportes", section: "Administración", description: "Consultas y reportes comerciales y operativos.", actions: ["Ventas", "Inventario", "Caja", "Exportar"], requiredPermissions: [] },
  { id: "users", label: "Usuarios", section: "Administración", description: "Alta, consulta, suspensión y administración de usuarios.", actions: ["Nuevo usuario", "Consultar usuario", "Suspender usuario", "Restablecer contraseña", "Revocar sesión"], requiredPermissions: [] },
  { id: "roles", label: "Roles y permisos", section: "Administración", description: "Asignación de roles, permisos y alcance organizacional.", actions: ["Gestionar roles", "Asignar permisos", "Revisar alcance"], requiredPermissions: [] },
  { id: "company", label: "Empresa", section: "Administración", description: "Datos y configuración de la empresa.", actions: ["Editar empresa", "Datos fiscales", "Políticas"], requiredPermissions: [] },
  { id: "branches", label: "Sucursales", section: "Administración", description: "Alta y administración de sucursales.", actions: ["Nueva sucursal", "Consultar sucursal", "Desactivar sucursal"], requiredPermissions: [] },
  { id: "devices", label: "Dispositivos", section: "Administración", description: "Registro, aprobación, actividad y ciclo de vida de dispositivos.", actions: ["Registrar dispositivo", "Aprobar dispositivo", "Reemplazar dispositivo"], requiredPermissions: [] },
  { id: "settings", label: "Configuración", section: "Administración", description: "Configuración general del entorno POS.", actions: ["Configuración general", "Sesión y seguridad", "Cambiar contraseña", "Cerrar sesiones", "Integraciones"], requiredPermissions: [] },
  { id: "licenses", label: "Licencias", section: "Plataforma", description: "Ciclo de vida de licencias y estado contractual.", actions: ["Emitir licencia", "Renovar", "Suspender", "Reactivar", "Revocar"], requiredPermissions: [] },
  { id: "plans", label: "Planes y suscripciones", section: "Plataforma", description: "Planes mensual, anual y perpetuo; suscripciones y derechos.", actions: ["Nuevo plan", "Cambiar plan", "Gestionar suscripción", "Consultar entitlements"], requiredPermissions: [] },
  { id: "super-admin", label: "Superadministrador", section: "Plataforma", description: "Administración global de plataforma, licencias y cuentas.", actions: ["Administrar cuentas", "Administrar licencias", "Administrar planes", "Iniciar recuperación asistida", "Revisar auditoría"], requiredPermissions: [] },
  { id: "support", label: "Soporte", section: "Plataforma", description: "Atención operativa y acciones autorizadas de soporte.", actions: ["Buscar cuenta", "Revisar dispositivo", "Registrar caso"], requiredPermissions: [] },
  { id: "admin-audit", label: "Auditoría administrativa", section: "Plataforma", description: "Trazabilidad de acciones administrativas y de plataforma.", actions: ["Consultar eventos", "Filtrar eventos"], requiredPermissions: [CanonicalPermission.AUDIT_EVENT_READ] },
];

function PlannedScreen({ screen }: { screen: PlannedScreenDefinition }): React.JSX.Element {
  if (screen.id === "dashboard") return <AdministrativeControlPanel kind="admin" />;
  if (screen.id === "super-admin") return <AdministrativeControlPanel kind="superadmin" />;
  if (screen.id === "admin-audit") return <AdministrativeControlPanel kind="audit" />;

  return (
    <section data-testid={`planned-screen-${screen.id}`}>
      <h2>{screen.label}</h2>
      <p>{screen.description}</p>
      <p className="pos-planned-state">Superficie de navegación materializada · las operaciones requieren contrato ejecutable y autorización backend.</p>
      <div className="pos-action-grid">
        {screen.actions.map((action) => (
          <button key={action} type="button" disabled title="La operación requiere un contrato de servicio ejecutable.">
            {action}
          </button>
        ))}
      </div>
    </section>
  );
}
import { useAuthorizationCapabilities } from "./hooks/useAuthorizationCapabilities.js";

function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

type Screen = {
  id: string;
  label: string;
  section: "Operación" | "Catálogo e inventario" | "Administración" | "Plataforma";
  render: () => React.JSX.Element;
  planned?: boolean;
};

export function App(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  const [visitedScreens, setVisitedScreens] = useState<ReadonlySet<string>>(new Set());
  const [receiptTarget, setReceiptTarget] = useState<string | null>(null);
  const [fiscalTarget, setFiscalTarget] = useState<string | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<string | null>(null);
  const navigateTo = useCallback((id: string, from: string | null): void => {
    setVisitedScreens((visited) => new Set([...visited, ...(from === null ? [] : [from]), id]));
    setActiveScreen(id);
  }, []);


  const screens = useMemo<Screen[]>(() => {
    if (authorization.phase !== "ready") return [];

    const { permissions } = authorization;
    const result: Screen[] = [];

    if (hasAny(permissions, [
      CanonicalPermission.CASH_SHIFT_OPEN,
      CanonicalPermission.CASH_SHIFT_CLOSE,
      CanonicalPermission.SALES_SALE_CREATE,
      CanonicalPermission.PAYMENTS_PAYMENT_REGISTER,
      CanonicalPermission.PAYMENTS_TRANSFER_REPORT,
      CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM,
      CanonicalPermission.PAYMENTS_PAYMENT_READ,
      CanonicalPermission.PAYMENTS_PAYMENT_CANCEL,
    ])) {
      result.push({
        id: "sales",
        label: "Caja y ventas",
        section: "Operación",
        render: () => <SalePanel permissions={permissions}
          onReceipt={permissions.has(CanonicalPermission.SALES_RECEIPT_READ) ? (id) => { setReceiptTarget(id); navigateTo("receipts", "sales"); } : undefined}
          onInvoice={permissions.has(CanonicalPermission.FISCAL_DOCUMENT_ISSUE) ? (id) => { setFiscalTarget(id); navigateTo("fiscal", "sales"); } : undefined} />,
      });
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

    for (const planned of plannedScreens) {
      if (!hasAny(permissions, planned.requiredPermissions)) continue;
      result.push({
        id: planned.id,
        label: planned.label,
        section: planned.section,
        planned: true,
        render: () => <PlannedScreen screen={planned} />,
      });
    }

    return result;
  }, [authorization, receiptTarget, fiscalTarget, inventoryTarget, navigateTo]);

  if (authorization.phase === "loading" || authorization.phase === "error") {
    const loading = authorization.phase === "loading";
    return (
      <main className="pos-entry" aria-busy={loading}>
        <section className="pos-entry-brand" aria-label="Camacho POS Colombia">
          <div className="pos-entry-logo" role="img" aria-label="Camacho POS Colombia" />
        </section>
        <section className="pos-entry-card" aria-label="Estado de acceso">
          <span className="pos-entry-eyebrow">CAMACHO POS COLOMBIA</span>
          <h1>Camacho POS Colombia</h1>
          <h2>{loading ? "Validando sesión" : "Acceso no disponible"}</h2>
          <p>{loading ? "Comprobando la sesión y los permisos efectivos." : "El POS no ha podido verificar una sesión autorizada."}</p>
          {loading ? (
            <div data-testid="authorization-loading" role="status">Cargando permisos…</div>
          ) : (
            <div data-testid="authorization-error" role="alert">
              No se pudo cargar la autorización: {authorization.message}
            </div>
          )}
          <StatusPanel />
        </section>
      </main>
    );
  }

  const selectedScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0] ?? null;

  return (
    <main className="pos-shell" data-visual-area={selectedScreen?.section === "Plataforma" ? "platform" : selectedScreen?.section === "Administración" ? "administration" : "operation"}>
      <aside className="pos-sidebar" aria-label="Navegación principal">
        <div className="pos-brand-mark" role="img" aria-label="Camacho POS Colombia" />
        <p className="pos-brand-name">Camacho POS Colombia</p>
        <p className="pos-subtitle">Acceso según permisos efectivos</p>
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
                    className={`pos-nav-button${screen.planned ? " pos-nav-button-planned" : ""}`}
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

      <div className="pos-content">
        <header className="pos-header">
          <div>
            <p className="pos-product-name">Camacho POS Colombia · {selectedScreen?.section ?? "Sesión autorizada"}</p>
            <h1>{selectedScreen?.label ?? "Sin acceso operativo"}</h1>
            <p>Operación disponible según los permisos efectivos de la sesión.</p>
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

        <details className="pos-operation" aria-label="Herramientas técnicas">
          <summary>Herramientas técnicas y diagnóstico</summary>
          <OperationPanel />
        </details>
      </div>
    </main>
  );
}
