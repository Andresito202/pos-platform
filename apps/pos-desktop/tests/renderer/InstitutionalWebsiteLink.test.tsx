// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InstitutionalWebsiteLink } from "../../renderer/src/components/InstitutionalWebsiteLink.js";
import { INSTITUTIONAL_WEBSITE_URL } from "../../renderer/src/institutional-site.js";

describe("InstitutionalWebsiteLink", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "posDesktopShell");
  });

  it("stays disabled when the secure desktop shell bridge is absent", () => {
    render(<InstitutionalWebsiteLink />);
    const link = screen.getByTestId("institutional-website-link") as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    expect(screen.getByText("Sitio web de Camacho POS Colombia")).toBeTruthy();
    expect(screen.queryByText(/sitio disponible/i)).toBeNull();
  });

  it("opens the institutional URL through the desktop shell without embedding credentials", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ ok: true, url: INSTITUTIONAL_WEBSITE_URL });
    Object.defineProperty(window, "posDesktopShell", {
      configurable: true,
      value: { openExternalUrl },
    });
    render(<InstitutionalWebsiteLink />);
    const link = screen.getByTestId("institutional-website-link") as HTMLButtonElement;
    expect(link.disabled).toBe(false);
    fireEvent.click(link);
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(1));
    expect(openExternalUrl).toHaveBeenCalledWith(INSTITUTIONAL_WEBSITE_URL);
    expect(openExternalUrl.mock.calls[0]?.[0]).not.toMatch(/token|session|password|credential/i);
  });
});
