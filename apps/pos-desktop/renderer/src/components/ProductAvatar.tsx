import { useEffect, useState } from "react";
import type { CatalogItemListItem, CatalogItemResult } from "@pos-platform/contracts";
import { peekCatalogMediaUrl, resolveCatalogMediaUrl } from "../catalog-media-cache.js";
import { onCatalogInventoryChanged } from "../catalog-invalidate.js";

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

function mediaIdOf(item: CatalogItemListItem | CatalogItemResult): string | null {
  return item.media_id ?? null;
}

export function ProductAvatar({
  businessType,
  item,
}: {
  readonly businessType?: PosBusinessType;
  /** Catalog listing tiles and barcode lookup have distinct, valid contracts. */
  readonly item: CatalogItemListItem | CatalogItemResult;
}): React.JSX.Element {
  const mediaId = mediaIdOf(item);
  const [src, setSrc] = useState<string | null>(
    mediaId === null ? null : peekCatalogMediaUrl(mediaId),
  );

  useEffect(() => {
    let cancelled = false;
    let requestVersion = 0;
    const update = (): void => {
      const version = ++requestVersion;
      if (mediaId === null) {
        setSrc(null);
        return;
      }
      const cached = peekCatalogMediaUrl(mediaId);
      if (cached !== null) {
        setSrc(cached);
        return;
      }
      setSrc(null);
      void resolveCatalogMediaUrl(mediaId).then((url) => {
        if (!cancelled && version === requestVersion) setSrc(url);
      });
    };
    update();
    // The existing local catalog event also refreshes an image replaced with
    // the same media_id; changing the React prop is not required.
    const unsubscribe = onCatalogInventoryChanged(update);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [mediaId]);

  if (src !== null) {
    return (
      <span
        className={`pos-product-avatar pos-product-avatar-photo pos-product-avatar-${businessType ?? "generic"}`}
        data-testid="product-avatar"
        title="Fotografía de catálogo verificada"
      >
        <img src={src} alt="" data-testid="product-avatar-image" />
      </span>
    );
  }

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
