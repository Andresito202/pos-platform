import { useEffect, useState } from "react";
import { callCommercial } from "../pos-service.js";

export type AuthorizationCapabilities =
  | { phase: "loading"; permissions: ReadonlySet<string> }
  | { phase: "ready"; permissions: ReadonlySet<string> }
  | { phase: "error"; permissions: ReadonlySet<string>; message: string };

export function useAuthorizationCapabilities(): AuthorizationCapabilities {
  const [state, setState] = useState<AuthorizationCapabilities>({
    phase: "loading",
    permissions: new Set(),
  });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await callCommercial<{
          outcome: "AVAILABLE" | "UNAUTHORIZED";
          permissions: string[];
        }>("authorization.capabilities.get", {});

        if (cancelled) return;

        if (response.status !== "SUCCEEDED" || response.result?.outcome !== "AVAILABLE") {
          setState({
            phase: "error",
            permissions: new Set(),
            message: response.result_code,
          });
          return;
        }

        setState({
          phase: "ready",
          permissions: new Set(response.result.permissions),
        });
      } catch (error) {
        if (!cancelled) {
          setState({
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
  }, []);

  return state;
}
