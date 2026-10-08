import type { CatalogItemResult } from "@pos-platform/contracts";

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
  readonly item: CatalogItemResult;
}): React.JSX.Element {
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
