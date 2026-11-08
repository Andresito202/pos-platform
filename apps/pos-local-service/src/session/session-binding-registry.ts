import type { SessionAssertionClaims } from "@pos-platform/contracts";

/**
 * Registro de vínculos conexión → identidad de sesión — `DEC-015`.
 *
 * Resuelve el bloqueo `PD-2`: los almacenes de SSA y de snapshot de
 * autorización se consultan por `user_id`, de modo que un handler necesita esa
 * identidad *antes* de poder leer nada. Aquí se establece, y sólo tras haber
 * verificado criptográficamente una SSA.
 *
 * **La clave es el `connectionId` asignado por el servidor**, no el
 * `session_id` del marco de transporte —que elige el cliente— ni el
 * `session_id` de los claims de la SSA —que emite la autoridad central—. Los
 * tres son identificadores distintos y confundirlos sería tratar como
 * autoridad un valor que el llamador controla.
 *
 * El `connectionId` no viaja por el cable: no puede adivinarse, robarse ni
 * reproducirse. Un llamador no puede presentar el vínculo de otro porque no
 * presenta vínculo alguno — lo aporta el transporte.
 *
 * ## Por qué no se persiste
 *
 * Un vínculo no puede sobrevivir a la conexión que lo origina, y una conexión
 * no sobrevive al proceso. Persistirlo crearía un vínculo referido a una
 * conexión inexistente: precisamente el estado que `DEC-015` §5.6 declara
 * inexpresable. Lo durable es la SSA (`local_session_assertion`,
 * `MIGRATION_007`), y de ella se rehidrata el vínculo mediante
 * `session.recover`. Por eso este bloque no introduce migración alguna.
 */

export interface BoundSessionIdentity {
  readonly userId: string;
  readonly ssaSessionId: string;
  readonly tenantMembershipId: string;
  readonly offlineValidUntil: string;
}

export function boundIdentityFromClaims(claims: SessionAssertionClaims): BoundSessionIdentity {
  return {
    userId: claims.user_id,
    ssaSessionId: claims.session_id,
    tenantMembershipId: claims.tenant_membership_id,
    offlineValidUntil: claims.offline_valid_until,
  };
}

export class SessionBindingRegistry {
  private readonly bindings = new Map<string, BoundSessionIdentity>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Vincula una conexión a una identidad **ya verificada**. Este registro no
   * verifica firmas: llamarlo con una identidad no verificada convertiría el
   * vínculo en una afirmación sin respaldo, que es justo lo que impide.
   *
   * Rebindar una conexión reemplaza el vínculo anterior: una conexión sostiene
   * como mucho una sesión, de modo que no puede quedar sirviendo a dos
   * identidades a la vez.
   */
  bind(connectionId: string, identity: BoundSessionIdentity): void {
    this.bindings.set(connectionId, identity);
  }

  /**
   * Identidad vinculada a la conexión, o `null` si no hay vínculo o si la
   * sesión ya expiró.
   *
   * La expiración se comprueba en cada resolución y **elimina** el vínculo: sin
   * gracia offline, igual que `SqliteSessionAssertionStore.loadActive`. Una
   * conexión que sobreviva a su SSA deja de tener identidad sin necesidad de
   * que nadie la desconecte.
   */
  resolve(connectionId: string): BoundSessionIdentity | null {
    const identity = this.bindings.get(connectionId);
    if (identity === undefined) return null;

    if (this.now().getTime() >= Date.parse(identity.offlineValidUntil)) {
      this.bindings.delete(connectionId);
      return null;
    }
    return identity;
  }

  /** Invalida el vínculo de una conexión cerrada (`DEC-015` §5.6). */
  release(connectionId: string): void {
    this.bindings.delete(connectionId);
  }
  releaseSession(sessionId:string):void{
    for(const [connection,identity] of this.bindings)if(identity.ssaSessionId===sessionId)this.bindings.delete(connection);
  }

  /** Invalida todos los vínculos. Se usa al detener el componente. */
  clear(): void {
    this.bindings.clear();
  }

  /** Número de vínculos vivos. Existe para que las pruebas puedan observarlo. */
  get size(): number {
    return this.bindings.size;
  }
}
