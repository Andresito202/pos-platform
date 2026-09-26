import type { ThrottleState } from "./login-throttle.js";

/**
 * Lo que el login dentro de un comercio necesita leer de una persona. Lo define
 * el consumidor (`TenantLoginService`), como pide `DEC-017` §4.3.
 */
export interface LoginCandidate {
  readonly userId: string;
  readonly userActive: boolean;
  readonly membershipId: string;
  readonly membershipActive: boolean;
  /** `null` si la persona no tiene credencial de contraseña activa. */
  readonly credential: {
    readonly id: string;
    readonly verifier: string;
    readonly throttle: ThrottleState;
    readonly mustChangeAtNextLogin: boolean;
  } | null;
}

export interface NewSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly authenticatedAt: Date;
  readonly expiresAt: Date;
  readonly refreshTokenId: string;
  readonly refreshTokenFamilyId: string;
  /** Sólo el hash: el token utilizable nunca llega al almacén. */
  readonly refreshTokenHash: string;
  readonly refreshTokenExpiresAt: Date;
}

export interface SecurityEvent {
  readonly eventCode: "LOGIN_SUCCEEDED" | "LOGIN_FAILED" | "LOGIN_THROTTLED" | "LOGIN_REFUSED";
  readonly result: "ACCEPTED" | "REJECTED";
  readonly reasonCode: string | null;
  readonly userId: string | null;
  /** Sólo con sesión: `security_events_tenant_session_ck` exige sesión si hay comercio. */
  readonly session: { readonly tenantId: string; readonly sessionId: string } | null;
  readonly ipAddress: string | null;
  readonly correlationId: string;
  readonly occurredAt: Date;
}

/** Todas las operaciones de un intento ocurren en una única transacción. */
export interface TenantLoginTransaction {
  /** Bloquea la credencial hasta el final de la transacción. */
  findForUpdate(normalizedLoginName: string): Promise<LoginCandidate | null>;
  activeRoleCodes(membershipId: string, at: Date): Promise<readonly string[]>;
  saveThrottle(credentialId: string, state: ThrottleState): Promise<void>;
  openSession(session: NewSession): Promise<void>;
  appendSecurityEvent(event: SecurityEvent): Promise<void>;
}

export interface TenantLoginStore {
  inTenant<T>(tenantId: string, work: (transaction: TenantLoginTransaction) => Promise<T>): Promise<T>;
}
