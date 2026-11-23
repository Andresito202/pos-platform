import "../brand.css";

const horizontal = new URL("../../../../../docs/brand/camacho-pos-colombia-login.png", import.meta.url).href;
const entryLogo = new URL("../../../../../docs/brand/camacho-pos-colombia-logo.png", import.meta.url).href;
const stacked = new URL("../../../../../docs/brand/camacho-pos-colombia-apilado.png", import.meta.url).href;

/** The same supplied identity across operator screens and public/administration portals. */
export function BrandMark({ variant }: { variant: "entry" | "sidebar" | "header" }): React.JSX.Element {
  // Entry uses the official transparent lockup (no baked white plate) on the navy panel.
  // Sidebar/header keep the commercial login/stacked artwork.
  const src = variant === "entry" ? entryLogo : horizontal;
  return (
    <picture className={`pos-brand pos-brand--${variant}`}>
      {variant === "sidebar" && <source media="(min-width: 1025px)" srcSet={stacked} />}
      <img src={src} alt="Camacho POS Colombia" decoding="async" />
    </picture>
  );
}
