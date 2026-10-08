import { useCallback, useEffect, useState } from "react";
import type { AuditEventListResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

export interface AuditFilters {
  readonly query: string;
  readonly actionCode: string;
  readonly resourceType: string;
  readonly actorType: "USER" | "DEVICE" | "SYSTEM" | "";
  readonly from: string;
  readonly to: string;
}

const EMPTY_FILTERS: AuditFilters = {
  query: "",
  actionCode: "",
  resourceType: "",
  actorType: "",
  from: "",
  to: "",
};

export interface AdministrativeAuditState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly filters: AuditFilters;
  readonly events: readonly AuditEventListResult["events"];
  readonly hasMore: boolean;
  readonly totalLoaded: number;
}

export function useAdministrativeAudit(enabled: boolean): AdministrativeAuditState & {
  setFilters(filters: AuditFilters): void;
  refresh(): Promise<void>;
  nextPage(): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [events, setEvents] = useState<readonly AuditEventListResult["events"]>([]);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (offset: number, append: boolean): Promise<void> => {
    if (!enabled) return;
    setBusy(true);
    setError(null);
    try {
      const response = await callCommercial("audit.event.list", {
        query: filters.query.trim(),
        action_code: filters.actionCode.trim() === "" ? null : filters.actionCode.trim(),
        resource_type: filters.resourceType.trim() === "" ? null : filters.resourceType.trim(),
        actor_type: filters.actorType === "" ? null : filters.actorType,
        from: filters.from.trim() === "" ? null : filters.from.trim(),
        to: filters.to.trim() === "" ? null : filters.to.trim(),
        limit: 50,
        offset,
      });
      if (response.status !== "SUCCEEDED" || response.result === null) {
        setError(response.result_code);
        return;
      }
      const result = response.result;
      if (result.outcome !== "FOUND") {
        setError("UNAUTHORIZED");
        return;
      }
      setEvents((current) => append ? [...current, ...result.events] : result.events);
      setHasMore(result.has_more);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, [enabled, filters]);

  const refresh = useCallback(async (): Promise<void> => {
    await load(0, false);
  }, [load]);

  const nextPage = useCallback(async (): Promise<void> => {
    if (!hasMore || busy) return;
    await load(events.length, true);
  }, [busy, events.length, hasMore, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    busy,
    error,
    filters,
    events,
    hasMore,
    totalLoaded: events.length,
    setFilters,
    refresh,
    nextPage,
  };
}
