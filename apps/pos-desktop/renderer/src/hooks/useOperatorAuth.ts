import { useCallback, useEffect, useState } from "react";
import type { SessionEndResult, SessionLoginOutcome, SessionLoginResult, SessionRecoverResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * Estado de autenticación del operador para la puerta de login (`DEC-026`
 * §13.11).
 *
 * El renderer **no decide** si alguien está autenticado: pregunta al servicio.
 * Al montar usa `session.recover` —el equipo puede tener ya una sesión vigente,
 * de un login anterior o de un artefacto de `DEC-025`—; `login` y `logout` son
 * `session.login` y `session.end`. Lo único que se guarda aquí es lo que el
 * servicio respondió, para pintarlo.
 *
 * Ni la contraseña ni el código salen de la llamada: no se guardan en estado.
 */

export type OperatorAuthPhase = "CHECKING" | "SIGNED_OUT" | "SIGNED_IN";

export interface OperatorSessionView {
  readonly sessionId: string;
  readonly offlineValidUntil: string;
}

export interface OperatorAuthFailure {
  readonly outcome: SessionLoginOutcome | "UNVERIFIABLE" | "TRANSPORT_ERROR";
  readonly decision: string | null;
  readonly retryAt: string | null;
}

export interface OperatorAuth {
  readonly phase: OperatorAuthPhase;
  readonly busy: boolean;
  readonly session: OperatorSessionView | null;
  readonly failure: OperatorAuthFailure | null;
  /** La autoridad pidió el código de la app autenticadora: la pantalla lo muestra. */
  readonly needsTotp: boolean;
  check(): Promise<void>;
  login(loginName: string, password: string, totpCode: string | null): Promise<void>;
  logout(): Promise<void>;
}

export function useOperatorAuth(): OperatorAuth {
  const [phase, setPhase] = useState<OperatorAuthPhase>("CHECKING");
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<OperatorSessionView | null>(null);
  const [failure, setFailure] = useState<OperatorAuthFailure | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);

  const check = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await callCommercial<SessionRecoverResult>("session.recover", {});
      const result = response.result;
      if (result !== null && result.outcome === "ACTIVE" && result.session_id !== null && result.offline_valid_until !== null) {
        setSession({ sessionId: result.session_id, offlineValidUntil: result.offline_valid_until });
        setFailure(null);
        setPhase("SIGNED_IN");
        return;
      }
      setSession(null);
      // `UNVERIFIABLE` se enseña: el equipo tiene sesión pero no puede probarla.
      setFailure(result !== null && result.outcome === "UNVERIFIABLE"
        ? { outcome: "UNVERIFIABLE", decision: result.decision, retryAt: null }
        : null);
      setPhase("SIGNED_OUT");
    } catch {
      setSession(null);
      setFailure({ outcome: "TRANSPORT_ERROR", decision: null, retryAt: null });
      setPhase("SIGNED_OUT");
    } finally {
      setBusy(false);
    }
  }, []);

  const login = useCallback(async (loginName: string, password: string, totpCode: string | null): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const response = await callCommercial<SessionLoginResult>("session.login", {
        login_name: loginName,
        password,
        totp_code: totpCode,
      });
      const result = response.result;
      if (result !== null && result.outcome === "AUTHENTICATED" && result.session_id !== null && result.offline_valid_until !== null) {
        setSession({ sessionId: result.session_id, offlineValidUntil: result.offline_valid_until });
        setNeedsTotp(false);
        setPhase("SIGNED_IN");
        return;
      }
      const outcome = result?.outcome ?? "TRANSPORT_ERROR";
      if (outcome === "MFA_REQUIRED" || outcome === "MFA_INVALID") setNeedsTotp(true);
      setFailure({ outcome, decision: result?.decision ?? null, retryAt: result?.retry_at ?? null });
    } catch {
      setFailure({ outcome: "TRANSPORT_ERROR", decision: null, retryAt: null });
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await callCommercial<SessionEndResult>("session.end", {});
    } finally {
      // Salga lo que salga, la ventana deja de mostrar la sesión: si el
      // servicio no la cerró, la siguiente comprobación la volverá a encontrar
      // y lo dirá, en vez de dejar el mostrador abierto con un botón muerto.
      setSession(null);
      setFailure(null);
      setNeedsTotp(false);
      setPhase("SIGNED_OUT");
      setBusy(false);
    }
  }, []);

  useEffect(() => { void check(); }, [check]);

  return { phase, busy, session, failure, needsTotp, check, login, logout };
}

/** Qué se le dice a la persona en cada desenlace. Nunca un código crudo solo. */
export function loginFailureMessage(failure: OperatorAuthFailure): string {
  switch (failure.outcome) {
    case "REJECTED": return "Usuario o contraseña incorrectos.";
    case "THROTTLED": return failure.retryAt === null
      ? "Demasiados intentos fallidos. Espere unos minutos e intente de nuevo."
      : `Demasiados intentos fallidos. Podrá intentarlo de nuevo a las ${new Date(failure.retryAt).toLocaleTimeString()}.`;
    case "PASSWORD_CHANGE_REQUIRED": return "Su contraseña es temporal y debe cambiarla. El cambio de contraseña todavía no está disponible en este equipo: pídaselo al administrador.";
    case "MFA_REQUIRED": return "Ingrese el código de 6 dígitos de su app autenticadora.";
    case "MFA_INVALID": return "El código de la app autenticadora no es correcto.";
    case "MFA_NOT_ENROLLED": return "Su cuenta de administración no tiene app autenticadora registrada.";
    case "ROLE_UNDECIDED": return "Su rol todavía no tiene una política de acceso definida.";
    case "NO_ACTIVE_ROLE": return "Su cuenta no tiene un rol activo en este comercio.";
    case "DEVICE_NOT_ENROLLED": return "Este equipo todavía no está enrolado en la plataforma.";
    case "DEVICE_REJECTED": return "La plataforma no reconoció este equipo.";
    case "CENTRAL_UNREACHABLE": return "No hay conexión con la plataforma. Iniciar sesión requiere Internet.";
    case "SESSION_NOT_ISSUED": return "La plataforma validó sus datos pero no entregó sesión para este equipo.";
    case "SESSION_REJECTED": return "Este equipo rechazó la sesión recibida de la plataforma.";
    case "UNVERIFIABLE": return "Este equipo tiene una sesión que no puede verificar. Inicie sesión de nuevo.";
    case "TRANSPORT_ERROR": return "No se pudo hablar con el servicio local de este equipo.";
    case "AUTHENTICATED": return "";
  }
}
