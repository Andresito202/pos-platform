import * as z from "zod";
import { CashierDestinationSchema } from "./merchant-destination.js";

/**
 * QR-001 company-wide read projection. A QR payload is NEVER payment evidence.
 * Important: this contract alone does not authenticate its origin. The trusted
 * caller MUST verify Central issuer, signature, session and device binding
 * before passing a snapshot to applyVerifiedDestinationSnapshot().
 */
const Uuid = z.string().uuid();
export const DestinationSnapshotSchema = z.strictObject({
  tenant_id: Uuid,
  company_id: Uuid,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issued_at: z.string().datetime({ offset: true }),
  /** An expired snapshot MUST NOT be displayed as an active bank destination. */
  expires_at: z.string().datetime({ offset: true }),
  /** null is a signed revocation/empty published configuration. */
  destination: CashierDestinationSchema.nullable(),
  /** Optional multi-method projection: one company can publish up to three distinct kinds. */
  destinations: z.array(CashierDestinationSchema).max(3).optional(),
}).superRefine((s, ctx) => {
  if (s.destinations !== undefined) {
    const kinds = new Set(s.destinations.map(item => item.kind));
    if (kinds.size !== s.destinations.length) ctx.addIssue({code:"custom",path:["destinations"],message:"methods must have unique kinds"});
    if ((s.destination === null) !== (s.destinations.length === 0)) {
      ctx.addIssue({code:"custom",path:["destination"],message:"primary destination must match active methods"});
    }
    if (s.destination !== null && s.destinations.length > 0) {
      const first=s.destinations[0]!;
      // The compatibility primary omits heavy PNG bytes; the actual official
      // image appears once in destinations[]. All financial identifiers,
      // versions and digests must remain identical.
      const fields=["kind","label","destination_reference","qr_asset_id","qr_sha256","version"] as const;
      if(fields.some(key=>s.destination?.[key]!==first[key]) ||
         (s.destination.qr_png_base64!==undefined && s.destination.qr_png_base64!==first.qr_png_base64)) {
        ctx.addIssue({code:"custom",path:["destination"],message:"primary destination must be first method"});
      }
    }
  }
  if (Date.parse(s.expires_at) <= Date.parse(s.issued_at)) {
    ctx.addIssue({code:"custom",path:["expires_at"],message:"expiry must follow issuance"});
  }
});
export type DestinationSnapshot = z.infer<typeof DestinationSnapshotSchema>;

export interface DestinationProjectionState {
  readonly snapshot: DestinationSnapshot;
  readonly received_at: string;
}
export interface DestinationProjectionScope {
  readonly tenantId: string;
  readonly companyId: string;
}

/**
 * The only entrypoint for PRE-VERIFIED snapshots. The verifier must be a trusted
 * service component; do not export it to Electron's renderer or accept it by IPC.
 * Persist the returned state atomically before acknowledging sync.
 */
export function applyVerifiedDestinationSnapshot(
  existing: DestinationProjectionState | null,
  candidateInput: DestinationSnapshot,
  scope: DestinationProjectionScope,
  receivedAt: string,
): DestinationProjectionState {
  const candidate = DestinationSnapshotSchema.parse(candidateInput);
  if(candidate.tenant_id !== scope.tenantId || candidate.company_id !== scope.companyId) {
    throw new Error("WRONG_SCOPE");
  }
  const clock = Date.parse(receivedAt);
  if(!Number.isFinite(clock)) throw new Error("INVALID_CLOCK");
  if(Date.parse(candidate.issued_at) > clock) throw new Error("FUTURE_SNAPSHOT");
  if(Date.parse(candidate.expires_at) <= clock) throw new Error("EXPIRED_SNAPSHOT");
  if(existing !== null) {
    const saved = DestinationSnapshotSchema.parse(existing.snapshot);
    if(saved.tenant_id !== scope.tenantId || saved.company_id !== scope.companyId) throw new Error("WRONG_STORED_SCOPE");
    if(candidate.sequence <= saved.sequence) throw new Error("OBSOLETE_OR_REPLAYED_SEQUENCE");
    if(Date.parse(candidate.issued_at) < Date.parse(saved.issued_at)) throw new Error("REGRESSING_ISSUANCE");
  }
  return {snapshot:candidate,received_at:new Date(clock).toISOString()};
}

/**
 * Never show a destination whose current validity is unknown, expired, or
 * mismatched in scope. All registers in this company get the same projection.
 * This is display-only, not proof of payment and not authorization to publish.
 */
export function visibleCompanyDestination(
  state: DestinationProjectionState | null,
  scope: DestinationProjectionScope,
  now: string,
) {
  if(state === null) return null;
  const {snapshot}=state;
  const clock=Date.parse(now);
  if(!Number.isFinite(clock)) return null;
  const parsed=DestinationSnapshotSchema.safeParse(snapshot);
  if(!parsed.success || parsed.data.tenant_id!==scope.tenantId || parsed.data.company_id!==scope.companyId) return null;
  if(clock < Date.parse(parsed.data.issued_at) || clock >= Date.parse(parsed.data.expires_at)) return null;
  return parsed.data.destination;
}

/**
 * Multi-method display for a company's four registers. Existing signed
 * snapshot consumers remain compatible with the singular primary destination.
 * All values here have already passed scope, time and schema checks.
 */
export function visibleCompanyDestinations(
  state: DestinationProjectionState | null,
  scope: DestinationProjectionScope,
  now: string,
): readonly import("./merchant-destination.js").CashierDestination[] {
  if (state === null) return [];
  const primary=visibleCompanyDestination(state,scope,now);
  if(primary === null) return [];
  const parsed=DestinationSnapshotSchema.safeParse(state.snapshot);
  if(!parsed.success) return [];
  return parsed.data.destinations ?? [primary];
}
