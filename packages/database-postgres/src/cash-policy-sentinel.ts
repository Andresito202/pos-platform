import { createHash } from "node:crypto";

/**
 * Bloque 24-B: D1's sentinel/checksum constants, duplicated (not imported)
 * from `packages/database-sqlite/src/local-database.ts` — the module
 * boundary (`tools/architecture/module-boundaries.json`) forbids one
 * adapter depending on another, and these are physical-layer constants, not
 * shared domain/application code. The literal values (sentinel UUID,
 * canonical behavior texts) MUST stay byte-identical to SQLite's; the
 * checksums below are computed from the same texts, not copied by hand, so
 * a future edit to either copy of the text is caught by the exported hash
 * changing rather than silently drifting.
 */
export const CASH_NO_POLICY_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
export const CASH_CALCULATION_BEHAVIOR_V0 =
  "ExpectedCash is computed as an unconditional fold of all POSTED CashMovement rows for the shift up to the closing cutoff sequence, signed by direction (IN adds, OUT subtracts), with no configurable tolerance, rounding, or policy engine; no CashPolicyVersion is applied.";
export const CASH_TOLERANCE_BEHAVIOR_V0 =
  "A CashDifferenceReview is created unconditionally whenever the closing count's difference_type is not EXACT (SHORTAGE or OVERAGE); there is no configurable tolerance threshold, materiality band, or approval policy - every non-exact difference is routed to review with no exception.";
export const CASH_CALCULATION_BEHAVIOR_CHECKSUM = createHash("sha256").update(CASH_CALCULATION_BEHAVIOR_V0).digest("hex");
export const CASH_TOLERANCE_BEHAVIOR_CHECKSUM = createHash("sha256").update(CASH_TOLERANCE_BEHAVIOR_V0).digest("hex");
