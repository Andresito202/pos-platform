import { LocalOperatorResponseSchema } from "@pos-platform/contracts";
import { useEffect, useState } from "react";
import { buildEnvelope, getPosService } from "../pos-service.js";
import type { LocalOperatorRole } from "../roleNavigation.js";

export type LocalOperatorSessionView = {
  readonly username: string | null;
  readonly role: LocalOperatorRole | null;
  readonly ready: boolean;
};

/**
 * Reads the local operator identity from the service. Role is for UX ordering
 * only — authorization.capabilities.get remains the permission source.
 */
export function useLocalOperatorSession(reloadToken = 0): LocalOperatorSessionView {
  const [view, setView] = useState<LocalOperatorSessionView>({
    username: null,
    role: null,
    ready: false,
  });

  useEffect(() => {
    let live = true;
    setView({ username: null, role: null, ready: false });
    void getPosService()["local.operator.session"](buildEnvelope("local.operator.session", {}))
      .then((value) => {
        if (!live) return;
        const result = LocalOperatorResponseSchema.safeParse(value);
        if (
          result.success
          && result.data.status === "SUCCEEDED"
          && result.data.result?.outcome === "AUTHENTICATED"
          && result.data.result.username !== null
          && result.data.result.role !== null
        ) {
          setView({
            username: result.data.result.username,
            role: result.data.result.role,
            ready: true,
          });
          return;
        }
        setView({ username: null, role: null, ready: true });
      })
      .catch(() => {
        if (live) setView({ username: null, role: null, ready: true });
      });
    return () => {
      live = false;
    };
  }, [reloadToken]);

  return view;
}
