/**
 * Visual navigation preference by local operator role.
 *
 * Permissions remain the sole authorization source. Role only reorders screens
 * that are already authorized; it never grants access to a screen.
 */
export type LocalOperatorRole =
  | "CAJERO"
  | "SUPERVISOR"
  | "ADMINISTRADOR"
  | "SUPERADMINISTRADOR";

export const ROLE_SCREEN_ORDER: Readonly<Record<LocalOperatorRole, readonly string[]>> = {
  CAJERO: ["sales", "customers", "catalog", "receipts", "fiscal"],
  SUPERVISOR: ["inventory", "catalog", "sales", "customers", "receipts", "fiscal"],
  ADMINISTRADOR: [
    "dashboard",
    "admin-audit",
    "sales",
    "catalog",
    "inventory",
    "customers",
    "receipts",
    "fiscal",
    "hardware",
  ],
  // Development local surface: only truly authorized admin audit screens.
  SUPERADMINISTRADOR: ["dashboard", "admin-audit"],
};

export function orderScreensByRole<T extends { id: string }>(
  screens: readonly T[],
  role: LocalOperatorRole | null,
): T[] {
  if (role === null || screens.length === 0) return [...screens];
  const preference = ROLE_SCREEN_ORDER[role];
  return [...screens].sort((left, right) => {
    const leftRank = preference.indexOf(left.id);
    const rightRank = preference.indexOf(right.id);
    const normalizedLeft = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
    const normalizedRight = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
    return normalizedLeft - normalizedRight;
  });
}

export function homeScreenId(
  screens: readonly { id: string }[],
  role: LocalOperatorRole | null,
): string | null {
  const ordered = orderScreensByRole(screens, role);
  return ordered[0]?.id ?? null;
}
