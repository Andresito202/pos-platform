import "../brand.css";

const horizontal = new URL("../../../../../docs/brand/camacho-pos-colombia-login.png", import.meta.url).href;
/** Official yellow/cash-register lockup, cropped for entry; transparent outside the mark. */
const entryLockup = new URL("../../../../../docs/brand/camacho-pos-colombia-login-entry.png", import.meta.url).href;
const stacked = new URL("../../../../../docs/brand/camacho-pos-colombia-apilado.png", import.meta.url).href;

/** The same supplied identity across operator screens and public/administration portals. */
export function BrandMark({ variant }: { variant: "entry" | "sidebar" | "header" }): React.JSX.Element {
  // Commercial entry must use the approved yellow cash-register lockup — never the metallic blue mark.
  const src = variant === "entry" ? entryLockup : horizontal;
  return (
    <picture className={`pos-brand pos-brand--${variant}`}>
      {variant === "sidebar" && <source media="(min-width: 1025px)" srcSet={stacked} />}
      <img src={src} alt="Camacho POS Colombia" decoding="async" />
    </picture>
  );
}
