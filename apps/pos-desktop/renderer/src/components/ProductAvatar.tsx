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
  // The item is intentionally not used to infer a business profile: the avatar
  // is driven by the configured business type, not by guessed product metadata.
  void item;
  const symbol = businessType === undefined ? "□" : avatarSymbols[businessType];
  return (
    <span
      className={`pos-product-avatar pos-product-avatar-${businessType ?? "generic"}`}
      aria-hidden="true"
      data-testid="product-avatar"
    >
      <span>{symbol}</span>
    </span>
  );
}
