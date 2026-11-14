import type { CatalogItemListItem, CatalogItemResult } from "@pos-platform/contracts";

export type PosBusinessType =
  | "tienda_barrio"
  | "minimercado"
  | "supermercado"
  | "perecederos"
  | "carniceria"
  | "fruver"
  | "cacharreria"
  | "papeleria"
  | "deposito_bebidas"
  | "licorera"
  | "drogueria"
  | "ferreteria"
  | "ropa"
  | "calzado"
  | "panaderia"
  | "mascotas"
  | "productos_aseo"
  | "alimentos_preparados";

const avatarSymbols: Record<PosBusinessType, string> = {
  tienda_barrio: "▦",
  minimercado: "▦",
  supermercado: "▤",
  perecederos: "◒",
  carniceria: "◇",
  fruver: "●",
  cacharreria: "◆",
  papeleria: "▤",
  deposito_bebidas: "▥",
  licorera: "◇",
  drogueria: "+",
  ferreteria: "⚙",
  ropa: "◇",
  calzado: "◖",
  panaderia: "◉",
  mascotas: "◇",
  productos_aseo: "✦",
  alimentos_preparados: "◉",
};

export function ProductAvatar({
  businessType,
  item,
}: {
  readonly businessType?: PosBusinessType;
  /** Catalog listing tiles and barcode lookup have distinct, valid contracts. */
  readonly item: CatalogItemListItem | CatalogItemResult;
}): React.JSX.Element {
  // No product photography is fabricated here. Until a verified catalog image
  // reference exists, the avatar stays a professional symbolic fallback.
  void item;
  const symbol = businessType === undefined ? "□" : avatarSymbols[businessType];
  return (
    <span
      className={`pos-product-avatar pos-product-avatar-${businessType ?? "generic"}`}
      aria-hidden="true"
      data-testid="product-avatar"
      title="Sin imagen de catálogo verificada"
    >
      <span>{symbol}</span>
    </span>
  );
}
