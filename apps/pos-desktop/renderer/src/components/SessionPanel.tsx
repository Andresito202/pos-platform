import { useSession } from "../hooks/useSession.js";

/**
 * El estado de sesión del equipo, que gobierna si el resto de la pantalla
 * sirve para algo.
 *
 * Va primero —antes incluso que el estado del servicio— porque es la primera
 * pregunta operativa del día: sin vínculo de sesión, cada botón de abajo
 * devuelve `SESSION_NOT_BOUND` y el cajero no tiene forma de saber por qué.
 *
 * No hay botón de activar. La activación exige una SSA firmada por la autoridad
 * emisora (`DEC-011`), que este repositorio todavía no tiene: es **D-28**. Un
 * botón que no puede funcionar sería peor que su ausencia, porque sugeriría que
 * el problema es del cajero.
 */
export function SessionPanel(): React.JSX.Element {
  const session = useSession();

  return (
    <section data-testid="session-panel">
      <h2>Sesión</h2>

      {session.busy && <div data-testid="session-checking">Comprobando la sesión del equipo…</div>}

      {session.session !== null && session.session.outcome === "ACTIVE" && (
        <div data-testid="session-active">
          Sesión activa · <span data-testid="session-id">{session.session.session_id}</span>
          {/* La ventana offline es el dato operativo: es lo que dice hasta
              cuándo se puede seguir vendiendo sin Internet. */}
          {" · válida sin conexión hasta "}
          <span data-testid="session-offline-valid-until">{session.session.offline_valid_until}</span>
        </div>
      )}

      {session.session !== null && session.session.outcome === "NONE" && (
        <div data-testid="session-none">
          Este equipo no tiene sesión activa. Ninguna operación comercial se
          aceptará hasta que se active una.
        </div>
      )}

      {session.session !== null && session.session.outcome === "UNVERIFIABLE" && (
        // El servicio nombra la causa; la pantalla la muestra sin interpretarla.
        // `AMBIGUOUS_DEVICE_SESSION` no es lo mismo que una sesión expirada, y
        // quien atiende el equipo necesita esa diferencia.
        <div data-testid="session-unverifiable">
          Sesión no verificable · <span data-testid="session-decision">{session.session.decision}</span>
        </div>
      )}

      <button
        data-testid="recover-session-button"
        onClick={() => { void session.recover(); }}
        disabled={session.busy}
      >
        Reintentar
      </button>

      {session.error !== null && <div data-testid="session-error">{session.error}</div>}
    </section>
  );
}
