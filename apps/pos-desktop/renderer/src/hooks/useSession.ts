import { useCallback, useEffect, useState } from "react";
import type { SessionRecoverResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * La sesión del cajero, que es la precondición de todo lo demás.
 *
 * ## El hueco que esto cierra
 *
 * `session.activate` y `session.recover` estaban ruteados por el puente desde
 * `f342f05` y **nada en el producto los llamaba**: ni un panel ni el proceso
 * principal. Una instalación real abría su ventana sin vínculo de sesión, y
 * entonces toda operación comercial se rechazaba con `SESSION_NOT_BOUND`
 * mostrando un error genérico. El servicio **sí** persiste la sesión, de modo
 * que el equipo que ayer funcionaba amanecía muerto sin que nadie lo
 * recuperase.
 *
 * ## Recuperar no es autenticar
 *
 * `session.recover` no lleva payload: no presenta credencial ni SSA. Pide al
 * servicio que busque la sesión activa **de este equipo** —`installation_id` y
 * `device_id` los impone la configuración local, nunca el llamador— y que
 * revincule la conexión si la encuentra. Es enteramente local: no consulta a
 * ninguna autoridad central y no verifica ninguna firma nueva.
 *
 * Por eso esta capa **no reintenta ni sondea**. Recuperar en bucle no
 * convertiría un `NONE` en una sesión: `NONE` significa que este equipo no
 * tiene ninguna, y eso sólo lo cambia una activación.
 *
 * ## Lo que esta capa deliberadamente NO hace
 *
 * **No activa.** `session.activate` exige una SSA firmada por la autoridad
 * emisora (`DEC-011`), y este repositorio no tiene ni esa autoridad ni material
 * de clave real —es la deuda **D-28**—. Un formulario que fabricase una SSA
 * aquí no sería un login: sería una credencial inventada, y el servicio la
 * rechazaría con `SIGNATURE_INVALID` incluso si se intentara.
 *
 * **No decide si la sesión sirve.** `offline_valid_until` se muestra tal cual
 * lo emite el servicio. La expiración la comprueba `SessionBindingRegistry` en
 * cada resolución, sin gracia; un juicio propio del renderer sobre esa fecha
 * podría diferir del que gobierna de verdad.
 */

export interface SessionState {
  readonly busy: boolean;
  readonly session: SessionRecoverResult | null;
  readonly error: string | null;
}

export function useSession(): SessionState & {
  recover(): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionRecoverResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recover = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // `UNVERIFIABLE` llega como rechazo del sobre y **es un desenlace que el
      // cajero debe ver**, no un fallo de transporte: sólo un `result` nulo
      // deja a la pantalla sin nada que mostrar.
      const response = await callCommercial<SessionRecoverResult>("session.recover", {});
      if (response.result === null) {
        setError(response.result_code);
        setSession(null);
        return;
      }
      setSession(response.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSession(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Una sola vez al montar: es lo que hace usable el equipo que ya tenía sesión.
  useEffect(() => { void recover(); }, [recover]);

  return { busy, session, error, recover };
}
