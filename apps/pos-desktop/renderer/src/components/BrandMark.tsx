import "../brand.css";

/**
 * Approved yellow / cash-register lockup (login entry crop).
 * Transparent outside the mark — same asset for entry, sidebar and header so
 * panels stay coherent with the approved login. Never the metallic-blue legacy mark.
 */
const approvedLockup = new URL(
  "../../../../../docs/brand/camacho-pos-colombia-login-entry.png",
  import.meta.url,
).href;

/** The same supplied identity across operator screens and public/administration portals. */
export function BrandMark({ variant }: { variant: "entry" | "sidebar" | "header" }): React.JSX.Element {
  return (
    <picture className={`pos-brand pos-brand--${variant}`}>
      <img src={approvedLockup} alt="Camacho POS Colombia" decoding="async" />
    </picture>
  );
}
