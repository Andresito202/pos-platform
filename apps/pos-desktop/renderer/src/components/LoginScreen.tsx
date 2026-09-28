import { useState } from "react";
import { StatusPanel } from "./StatusPanel.js";
import { loginFailureMessage, type OperatorAuth } from "../hooks/useOperatorAuth.js";

/**
 * Pantalla de inicio de sesión del operador (`DEC-026` §13.11).
 *
 * Sólo recoge lo que la persona teclea y se lo entrega al servicio: quién es el
 * comercio, qué equipo es y qué puede hacer cada quien lo resuelven el servicio
 * y la autoridad, nunca esta pantalla. El campo del código aparece cuando la
 * autoridad lo pide (roles de administración, `A-4`).
 *
 * «Comprobar sesión del equipo» existe para el equipo que recibió su sesión
 * por otra vía —el artefacto de `DEC-025`—: vuelve a preguntar al servicio.
 */
export function LoginScreen({ auth }: { readonly auth: OperatorAuth }): React.JSX.Element {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showTotp, setShowTotp] = useState(false);

  const totpVisible = showTotp || auth.needsTotp;
  const canSubmit = !auth.busy && loginName.trim() !== "" && password !== ""
    && (!totpVisible || /^\d{6}$/.test(totpCode));

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    const code = totpVisible ? totpCode : null;
    // La contraseña no sobrevive al intento: se limpia pase lo que pase.
    const secret = password;
    setPassword("");
    setTotpCode("");
    void auth.login(loginName.trim(), secret, code);
  };

  return (
    <div className="login-shell" data-testid="login-screen">
      <form className="login-card" onSubmit={submit} aria-labelledby="login-title">
        <header className="login-brand">
          <span className="app-mark" aria-hidden="true">CP</span>
          <div>
            <h1 id="login-title">Camacho POS</h1>
            <p>Inicie sesión para operar este equipo</p>
          </div>
        </header>

        {auth.phase === "CHECKING" ? (
          <div className="login-checking" data-testid="login-checking">Comprobando la sesión del equipo…</div>
        ) : (
          <>
            <label className="login-field">
              <span>Usuario</span>
              <input
                data-testid="login-name-input"
                autoComplete="username"
                autoFocus
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
              />
            </label>
            <label className="login-field">
              <span>Contraseña</span>
              <input
                data-testid="login-password-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {totpVisible && (
              <label className="login-field">
                <span>Código de la app autenticadora</span>
                <input
                  data-testid="login-totp-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))}
                />
              </label>
            )}

            {auth.failure !== null && auth.failure.outcome !== "AUTHENTICATED" && (
              <div className="login-error" role="alert" data-testid="login-error" data-outcome={auth.failure.outcome}>
                {loginFailureMessage(auth.failure)}
                {auth.failure.decision !== null && <span className="login-error-code"> ({auth.failure.decision})</span>}
              </div>
            )}

            <button type="submit" data-testid="login-submit-button" disabled={!canSubmit}>
              {auth.busy ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>

            <div className="login-secondary">
              {!totpVisible && (
                <button type="button" className="login-link" data-testid="login-show-totp" onClick={() => setShowTotp(true)}>
                  Soy administrador (tengo código)
                </button>
              )}
              <button type="button" className="login-link" data-testid="login-recheck-button" disabled={auth.busy} onClick={() => { void auth.check(); }}>
                Comprobar sesión del equipo
              </button>
            </div>
          </>
        )}
      </form>
      <div className="login-status"><StatusPanel /></div>
    </div>
  );
}
