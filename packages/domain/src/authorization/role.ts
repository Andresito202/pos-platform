/**
 * Transcribed verbatim from docs/security/permission-matrix.md
 * ("## Roles") — 14 roles, not invented, not narrowed. Which of these can
 * actually do anything with Cash is a separate question (cash-role-policy.ts),
 * evaluated only for the two operations this codebase has a use case for.
 */
export type Role =
  | "PLATFORM_OWNER" | "BILLING_ADMIN" | "SUPPORT_AGENT" | "SECURITY_ADMIN"
  | "OWNER" | "GENERAL_ADMIN" | "BRANCH_MANAGER" | "SUPERVISOR" | "CASHIER"
  | "INVENTORY_OPERATOR" | "PURCHASING_OPERATOR" | "PREPARATION_OPERATOR"
  | "COURIER" | "CUSTOMER";
