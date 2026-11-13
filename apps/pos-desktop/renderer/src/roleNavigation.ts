/**
 * Workspace surfaces by local operator role.
 *
 * Backend permissions authorize operations. This list narrows and orders the
 * already-authorized screens for each workspace; it never grants permission.
 */
export type LocalOperatorRole =
  | "CAJERO"
  | "SUPERVISOR"
  | "ADMINISTRADOR"
  | "SUPERADMINISTRADOR";

export const ROLE_SCREEN_ORDER: Readonly<Record<LocalOperatorRole, readonly string[]>> = {
  CAJERO: ["sales", "customers", "catalog", "receipts", "fiscal"],
  SUPERVISOR: ["inventory", "payment-review", "catalog", "customers", "receipts", "fiscal"],
  ADMINISTRADOR: [
    "dashboard",
    "admin-audit",
    "payment-review",
    "catalog",
    "inventory",
    "customers",
    "receipts",
    "fiscal",
    "hardware",
  ],
  // Business-scoped operations still require backend capabilities. GLOBAL is separate.
  SUPERADMINISTRADOR: ["dashboard", "admin-audit", "sales", "payment-review", "inventory", "catalog", "customers", "receipts", "fiscal"],
};

export function orderScreensByRole<T extends { id: string }>(
  screens: readonly T[],
  role: LocalOperatorRole | null,
): T[] {
  if (role === null || screens.length === 0) return [...screens];
  const preference = ROLE_SCREEN_ORDER[role];
  return screens.filter(screen => preference.includes(screen.id)).sort((left, right) => {
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

