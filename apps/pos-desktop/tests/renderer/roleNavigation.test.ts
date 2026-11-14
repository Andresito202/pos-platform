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
    ]);
    expect(homeScreenId(screens, "SUPERADMINISTRADOR")).toBe("dashboard");
  });
  it.each(["SUPERVISOR", "ADMINISTRADOR", "SUPERADMINISTRADOR"] as const)("never exposes a cart to %s", role => {
    expect(orderScreensByRole(screens, role).map(s => s.id)).not.toContain("sales");
    expect(homeScreenId([{ id: "sales" }], role)).toBeNull();
  });
  it("does not invent a payment review surface absent from capabilities", () => {
    expect(orderScreensByRole(screens, "SUPERVISOR").map(s => s.id)).not.toContain("payment-review");
  });
});

