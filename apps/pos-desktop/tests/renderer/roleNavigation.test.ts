import { describe, expect, it } from "vitest";
import { homeScreenId, orderScreensByRole, ROLE_SCREEN_ORDER } from "../../renderer/src/roleNavigation.js";

describe("roleNavigation", () => {
  const screens = [
    { id: "sales" },
    { id: "catalog" },
    { id: "inventory" },
    { id: "customers" },
    { id: "receipts" },
    { id: "dashboard" },
    { id: "admin-audit" },
  ];

  it("keeps permission-driven order when no local role is present", () => {
    expect(orderScreensByRole(screens, null).map((screen) => screen.id)).toEqual(
      screens.map((screen) => screen.id),
    );
  });

  it("starts CAJERO on Caja y ventas without inventing screens", () => {
    expect(homeScreenId(screens, "CAJERO")).toBe("sales");
    expect(orderScreensByRole(screens, "CAJERO").map((s) => s.id)[0]).toBe("sales");
    expect(ROLE_SCREEN_ORDER.CAJERO).not.toContain("dashboard");
  });

  it("starts SUPERVISOR on inventario when that surface is authorized", () => {
    expect(homeScreenId(screens, "SUPERVISOR")).toBe("inventory");
  });

  it("starts ADMINISTRADOR on Dashboard and does not auto-open the cart", () => {
    expect(homeScreenId(screens, "ADMINISTRADOR")).toBe("dashboard");
    expect(orderScreensByRole(screens, "ADMINISTRADOR").map((s) => s.id)[0]).not.toBe("sales");
  });

  it("limits SUPERADMINISTRADOR visual preference to authorized audit surfaces", () => {
    expect(orderScreensByRole(screens, "SUPERADMINISTRADOR").map((s) => s.id)).toEqual([
      "dashboard",
      "admin-audit",
      "sales",
      "catalog",
      "inventory",
      "customers",
      "receipts",
    ]);
    expect(homeScreenId(screens, "SUPERADMINISTRADOR")).toBe("dashboard");
  });
});
