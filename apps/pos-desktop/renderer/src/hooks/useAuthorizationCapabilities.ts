import { AuthorizationCapabilitiesGetResultSchema, SessionRecoverResultSchema } from "@pos-platform/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callCommercial, observeAccessInvalidation } from "../pos-service.js";

type AuthorizationState =
  | { phase: "loading"; permissions: ReadonlySet<string>; entitlements: ReadonlySet<string> }
  | { phase: "ready"; permissions: ReadonlySet<string>; entitlements: ReadonlySet<string> }
  | { phase: "unauthenticated"; permissions: ReadonlySet<string>; entitlements: ReadonlySet<string> }
  | { phase: "denied"; permissions: ReadonlySet<string>; entitlements: ReadonlySet<string> }
  | { phase: "expired"; permissions: ReadonlySet<string>; entitlements: ReadonlySet<string> }
  | { phase: "error"; permissions: ReadonlySet<string>; entitlements: ReadonlySet<string>; message: string };
export type AuthorizationCapabilities = AuthorizationState & { retry: () => void };

const emptyAccess = { permissions: new Set<string>(), entitlements: new Set<string>() };

/**
 * Operator-facing copy only. Never treats transport codes such as `OK`
 * (used by `runtime.status.get`) as an authorization grant, and never echoes
 * raw codes that contradict the visible failure state.
 */
export function describeAuthorizationFailure(resultCode: string): string {
  switch (resultCode) {
    case "LOCAL_SERVICE_UNAVAILABLE":
      return "No hay conexión con el servicio local del POS.";
    case "CHANNEL_BROKEN":
      return "El canal con el servicio local se interrumpió.";
    case "AUTHORIZATION_SNAPSHOT_UNAVAILABLE":
      return "No hay una autorización vigente en este dispositivo.";
    case "AUTHORIZATION_RESPONSE_INVALID":
    case "SESSION_RECOVERY_RESPONSE_INVALID":
    case "OK":
      return "La respuesta de autorización no es válida.";
    case "UNVERIFIABLE":
      return "No fue posible verificar la sesión almacenada.";
    default:
      return "No fue posible verificar los permisos de acceso.";
  }
}

function failureFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message === "AUTHORIZATION_RESPONSE_INVALID"
      || error.message === "SESSION_RECOVERY_RESPONSE_INVALID"
    ) {
      return describeAuthorizationFailure(error.message);
    }
  }
  return describeAuthorizationFailure("LOCAL_SERVICE_UNAVAILABLE");
}

export function useAuthorizationCapabilities(): AuthorizationCapabilities {
  const [state, setState] = useState<AuthorizationState>({
    phase: "loading",
    ...emptyAccess,
  });
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const retry = useCallback(() => {
    generation.current++;
    // Keep an already-authorized shell mounted during background revalidation
    // (e.g. window focus). Flashing `loading` unmounted the workspace and
    // wiped activeScreen back to the role home — including mid-navigation.
    setState((prev) => (
      prev.phase === "ready" ? prev : { phase: "loading", ...emptyAccess }
    ));
    setReload(value => value + 1);
  }, []);

  useEffect(() => observeAccessInvalidation(reason => {
    generation.current++;
    setState(reason === "SESSION_NOT_BOUND"
      ? { phase: "unauthenticated", ...emptyAccess }
      : { phase: "error", ...emptyAccess, message: describeAuthorizationFailure(reason) });
  }), []);

  useEffect(() => {
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [retry]);

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
          if (recovered.status === "REJECTED" && recovered.result_code === "UNVERIFIABLE" &&
              result.data.outcome === "UNVERIFIABLE" && result.data.decision === "EXPIRED") {
            commit({ phase: "expired", ...emptyAccess });
            return;
          }
          if (recovered.status === "SUCCEEDED" && recovered.result_code === "NONE" && result.data.outcome === "NONE" &&
            result.data.session_id === null && result.data.offline_valid_until === null && result.data.decision === null) {
            commit({ phase: "unauthenticated", ...emptyAccess });
            return;
          }
          if (recovered.status !== "SUCCEEDED" || recovered.result_code !== "ACTIVE" || result.data.outcome !== "ACTIVE" ||
            result.data.session_id === null || result.data.offline_valid_until === null || result.data.decision !== null) {
            commit({
              phase: "error",
              ...emptyAccess,
              message: describeAuthorizationFailure(recovered.result_code),
            });
            return;
          }
          // ACTIVE is not a permission grant. Read only the backend's effective
          // capabilities after the canonical verifier has restored the binding.
          response = await callCommercial("authorization.capabilities.get", {});
        }

        const result = AuthorizationCapabilitiesGetResultSchema.safeParse(response.result);
        // Fail closed: only AVAILABLE + matching payload grants capabilities.
        // Codes such as OK (runtime status) must never unlock the shell.
        if (response.status !== "SUCCEEDED" || response.result_code !== "AVAILABLE" || !result.success || result.data.outcome !== "AVAILABLE") {
          commit({
            phase: "error",
            ...emptyAccess,
            message: describeAuthorizationFailure(response.result_code),
          });
          return;
        }

        commit({
          phase: result.data.permissions.length === 0 ? "denied" : "ready",
          permissions: new Set(result.data.permissions),
          entitlements: new Set(result.data.entitlements),
        });
      } catch (error) {
        if (!cancelled) {
          commit({
            phase: "error",
            ...emptyAccess,
            message: failureFromUnknown(error),
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
