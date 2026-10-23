import { AuthorizationCapabilitiesGetResultSchema, SessionRecoverResultSchema } from "@pos-platform/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callCommercial } from "../pos-service.js";

type AuthorizationState =
  | { phase: "loading"; permissions: ReadonlySet<string> }
  | { phase: "ready"; permissions: ReadonlySet<string> }
  | { phase: "unauthenticated"; permissions: ReadonlySet<string> }
  | { phase: "error"; permissions: ReadonlySet<string>; message: string };
export type AuthorizationCapabilities = AuthorizationState & { retry: () => void };

export function useAuthorizationCapabilities(): AuthorizationCapabilities {
  const [state, setState] = useState<AuthorizationState>({
    phase: "loading",
    permissions: new Set(),
  });
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const retry = useCallback(() => {
    generation.current++;
    setState({ phase: "loading", permissions: new Set() });
    setReload(value => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = ++generation.current;
    const commit = (next: AuthorizationState) => {
      if (!cancelled && requestGeneration === generation.current) setState(next);
    };

    async function load(): Promise<void> {
      try {
        let response = await callCommercial("authorization.capabilities.get", {});

        if (cancelled || requestGeneration !== generation.current) return;
        // Only an unbound connection needs recovery. Existing bound sessions
        // retain their normal capabilities path; recovery cannot invent a user.
        if (response.status === "REJECTED" && response.result_code === "SESSION_NOT_BOUND") {
          const initial = AuthorizationCapabilitiesGetResultSchema.safeParse(response.result);
          if (!initial.success || initial.data.outcome !== "UNAUTHORIZED" || initial.data.permissions.length !== 0) {
            throw Error("AUTHORIZATION_RESPONSE_INVALID");
          }
          const recovered = await callCommercial("session.recover", {});
          if (cancelled || requestGeneration !== generation.current) return;
          const result = SessionRecoverResultSchema.safeParse(recovered.result);
          if (!result.success) throw Error("SESSION_RECOVERY_RESPONSE_INVALID");
          if (recovered.status === "SUCCEEDED" && recovered.result_code === "NONE" && result.data.outcome === "NONE" &&
            result.data.session_id === null && result.data.offline_valid_until === null && result.data.decision === null) {
            commit({ phase: "unauthenticated", permissions: new Set() });
            return;
          }
          if (recovered.status !== "SUCCEEDED" || recovered.result_code !== "ACTIVE" || result.data.outcome !== "ACTIVE" ||
            result.data.session_id === null || result.data.offline_valid_until === null || result.data.decision !== null) {
            commit({ phase: "error", permissions: new Set(), message: recovered.result_code });
            return;
          }
          // ACTIVE is not a permission grant. Read only the backend's effective
          // capabilities after the canonical verifier has restored the binding.
          response = await callCommercial("authorization.capabilities.get", {});
        }

        const result = AuthorizationCapabilitiesGetResultSchema.safeParse(response.result);
        if (response.status !== "SUCCEEDED" || response.result_code !== "AVAILABLE" || !result.success || result.data.outcome !== "AVAILABLE") {
          commit({
            phase: "error",
            permissions: new Set(),
            message: response.result_code,
          });
          return;
        }

        commit({
          phase: "ready",
          permissions: new Set(result.data.permissions),
        });
      } catch (error) {
        if (!cancelled) {
          commit({
            phase: "error",
            permissions: new Set(),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
