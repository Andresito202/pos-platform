import { useCallback, useState } from "react";
import {
  INSTITUTIONAL_WEBSITE_LABEL,
  INSTITUTIONAL_WEBSITE_URL,
} from "../institutional-site.js";

type DesktopShellApi = {
  readonly openExternalUrl?: (url: string) => Promise<{ ok: boolean; reason?: string }>;
};

function readDesktopShell(): DesktopShellApi | null {
  if (!("posDesktopShell" in window)) return null;
  const shell = (window as Window & { posDesktopShell?: DesktopShellApi }).posDesktopShell;
  return shell ?? null;
}

/**
 * Institutional link shown under the shared login card for every operator role.
 * Opens only through the allowlisted desktop shell bridge (OS browser).
 */
export function InstitutionalWebsiteLink(): React.JSX.Element {
  const shell = readDesktopShell();
  const canOpen = typeof shell?.openExternalUrl === "function";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onActivate = useCallback(() => {
    if (!canOpen || busy || shell?.openExternalUrl === undefined) return;
    setBusy(true);
    setNotice(null);
    void shell.openExternalUrl(INSTITUTIONAL_WEBSITE_URL)
      .then((result) => {
        if (!result.ok) {
          setNotice("No fue posible abrir el sitio institucional en este momento.");
        }
      })
      .catch(() => {
        setNotice("No fue posible abrir el sitio institucional en este momento.");
      })
      .finally(() => {
        setBusy(false);
      });
  }, [busy, canOpen, shell]);

  return (
    <div className="pos-entry-site" data-testid="institutional-website">
      <button
        type="button"
        className="pos-entry-site-link"
        data-testid="institutional-website-link"
        disabled={!canOpen || busy}
        aria-disabled={!canOpen || busy}
        title={canOpen ? INSTITUTIONAL_WEBSITE_URL : "Enlace institucional pendiente de habilitación segura"}
        onClick={onActivate}
      >
        <img
          className="pos-entry-site-icon"
          src={new URL("../assets/payment-icons/globe.svg", import.meta.url).href}
          alt=""
        />
        <span className="pos-entry-site-host">{INSTITUTIONAL_WEBSITE_LABEL}</span>
      </button>
      <p className="pos-entry-site-caption">Sitio web de Camacho POS Colombia</p>
      {!canOpen && (
        <p className="pos-entry-site-note" role="status">
          El enlace se habilitará cuando la apertura externa segura esté disponible en este escritorio.
        </p>
      )}
      {notice !== null && (
        <p className="pos-entry-site-note" role="status">{notice}</p>
      )}
    </div>
  );
}
