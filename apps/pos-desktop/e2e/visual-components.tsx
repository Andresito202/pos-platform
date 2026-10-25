/** Static visual review of actual components with zero capabilities/data.
 * No hydration, effects, bridge, native authority or operation handlers run.
 * This module is never imported by a product entrypoint. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalePanel } from "../renderer/src/components/SalePanel.js";
import { CatalogPanel } from "../renderer/src/components/CatalogPanel.js";
import { InventoryPanel } from "../renderer/src/components/InventoryPanel.js";
import { CustomerPanel } from "../renderer/src/components/CustomerPanel.js";
import { AdministrativeControlPanel } from "../renderer/src/components/AdministrativeControlPanel.js";
import { HardwarePanel } from "../renderer/src/components/HardwarePanel.js";
import { ReceiptPanel } from "../renderer/src/components/ReceiptPanel.js";
import { FiscalPanel } from "../renderer/src/components/FiscalPanel.js";

const none: ReadonlySet<string> = new Set();
export function componentMarkup(name: string): string {
  const views: Record<string, React.ReactNode> = {
    sales: <SalePanel permissions={none} />,
    catalog: <CatalogPanel permissions={none} />,
    inventory: <InventoryPanel permissions={none} />,
    customers: <CustomerPanel permissions={none} />,
    admin: <AdministrativeControlPanel kind="admin" />,
    hardware: <HardwarePanel />,
    receipt: <ReceiptPanel />,
    fiscal: <FiscalPanel />,
  };
  if (!Object.hasOwn(views, name)) throw Error("UNKNOWN_COMPONENT_REVIEW");
  return renderToStaticMarkup(<div className="pos-content"><p className="pos-product-name">Revisión estática del componente · sin sesión ni datos</p><div inert className="pos-screen"><div>{views[name]}</div></div></div>);
}
