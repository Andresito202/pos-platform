import { describe, it, expect, vi, beforeEach } from "vitest";

const openExternal = vi.fn().mockResolvedValue(undefined);

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: {
    openExternal: (url: string) => openExternal(url),
  },
}));

describe("desktop shell openExternal allowlist", () => {
  beforeEach(() => {
    openExternal.mockClear();
    vi.resetModules();
  });

  it("opens only the institutional HTTPS URL in the OS browser", async () => {
    const { openAllowedExternalHttpsUrl } = await import("../src/desktop-shell.js");
    await expect(openAllowedExternalHttpsUrl("https://camachoposcolombia.com")).resolves.toEqual({
      ok: true,
      url: "https://camachoposcolombia.com",
    });
    expect(openExternal).toHaveBeenCalledWith("https://camachoposcolombia.com");
  });

  it("never calls openExternal for non-allowlisted URLs", async () => {
    const { openAllowedExternalHttpsUrl } = await import("../src/desktop-shell.js");
    await expect(openAllowedExternalHttpsUrl("https://evil.example")).resolves.toEqual({
      ok: false,
      reason: "DENIED",
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
