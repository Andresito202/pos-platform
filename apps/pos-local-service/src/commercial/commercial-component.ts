import type { RuntimeComponent } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import type { DurableSyncComponent } from "../sync/durable-sync-component.js";
import type { ServiceConfig } from "../config.js";
import type { TrustedSigningKey } from "../security/license-verifier.js";
import { TrustedClockGuard } from "../security/trusted-clock.js";
import { SessionAssertionVerifier } from "../security/session-assertion-verifier.js";
import { SqliteSessionAssertionStore } from "../session/sqlite-session-assertion-store.js";
import { SessionActivationService } from "../session/session-activation.js";
import { SessionBindingRegistry } from "../session/session-binding-registry.js";
import { SqliteAuthorizationSnapshotStore } from "../authorization/sqlite-authorization-snapshot-store.js";
import { SqliteMasterSnapshotStore } from "../master-data/sqlite-master-snapshot-store.js";
import { SqliteCashShiftStore } from "../cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../cash/open-cash-shift-use-case.js";
import { CloseCashShiftUseCase } from "../cash/close-cash-shift-use-case.js";
import { SqliteSaleStore } from "../sales/sqlite-sale-store.js";
import { SandboxCatalogStore } from "../sales/sandbox-catalog-store.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";
import { SqlitePaymentStore } from "../payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../payments/register-cash-payment-use-case.js";
import { RegisterTransferPaymentUseCase } from "../payments/register-transfer-payment-use-case.js";
import { ConfirmTransferPaymentUseCase } from "../payments/confirm-transfer-payment-use-case.js";
import { CancelPaymentUseCase } from "../payments/cancel-payment-use-case.js";
import { GetPaymentUseCase } from "../payments/get-payment-use-case.js";

/**
 * Componente que reúne la superficie comercial V1 — `DEC-014` / `DEC-015`.
 *
 * No implementa reglas de negocio: construye los casos de uso ya materializados
 * en `BLOQUE 4C` y `BLOQUE 4D` y sostiene el registro de vínculos de sesión.
 * Ningún archivo de `cash/` ni de `sales/` se modifica para exponerlos.
 *
 * ## Claves de firma
 *
 * `sessionSigningKeys` se inyecta. Hoy el runtime no dispone de una vía de
 * aprovisionamiento de claves —la misma carencia `LIC-003` / `DEV-003` que ya
 * afecta a licencia y snapshot de autorización— de modo que en producción el
 * mapa llega vacío y `session.activate` **falla cerrado**: una `key_id`
 * desconocida se reporta como `SIGNATURE_INVALID`. Se prefiere esa negativa a
 * fabricar una confianza que nadie ha provisto.
 */
export class CommercialComponent implements RuntimeComponent {
  readonly name = "commercial";

  private state:
    | {
        readonly sessionStore: SqliteSessionAssertionStore;
        readonly sessionActivation: SessionActivationService;
        readonly authorizationStore: SqliteAuthorizationSnapshotStore;
        readonly openCashShift: OpenCashShiftUseCase;
        readonly closeCashShift: CloseCashShiftUseCase;
        readonly createSale: CreateSaleUseCase;
        readonly registerCashPayment: RegisterCashPaymentUseCase;
        readonly registerTransferPayment: RegisterTransferPaymentUseCase;
        readonly confirmTransferPayment: ConfirmTransferPaymentUseCase;
        readonly cancelPayment: CancelPaymentUseCase;
        readonly getPayment: GetPaymentUseCase;
      }
    | undefined;

  readonly bindings: SessionBindingRegistry;

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly durableSync: DurableSyncComponent,
    private readonly sessionSigningKeys: ReadonlyMap<string, TrustedSigningKey> = new Map(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.bindings = new SessionBindingRegistry(now);
  }

  private get ready(): NonNullable<CommercialComponent["state"]> {
    if (!this.state) throw new Error("commercial component is not ready");
    return this.state;
  }

  get sessionStore(): SqliteSessionAssertionStore { return this.ready.sessionStore; }
  get sessionActivation(): SessionActivationService { return this.ready.sessionActivation; }
  get authorizationStore(): SqliteAuthorizationSnapshotStore { return this.ready.authorizationStore; }
  get openCashShift(): OpenCashShiftUseCase { return this.ready.openCashShift; }
  get closeCashShift(): CloseCashShiftUseCase { return this.ready.closeCashShift; }
  get createSale(): CreateSaleUseCase { return this.ready.createSale; }
  get registerCashPayment(): RegisterCashPaymentUseCase { return this.ready.registerCashPayment; }
  get registerTransferPayment(): RegisterTransferPaymentUseCase { return this.ready.registerTransferPayment; }
  get confirmTransferPayment(): ConfirmTransferPaymentUseCase { return this.ready.confirmTransferPayment; }
  get cancelPayment(): CancelPaymentUseCase { return this.ready.cancelPayment; }
  get getPayment(): GetPaymentUseCase { return this.ready.getPayment; }

  async start(): Promise<void> {
    const database = this.localDatabase.database;
    const sync = this.durableSync.store;

    const sessionStore = new SqliteSessionAssertionStore(database, this.now);
    const verifier = new SessionAssertionVerifier(
      this.sessionSigningKeys,
      new TrustedClockGuard(database),
      this.now,
    );

    const cashShiftStore = new SqliteCashShiftStore(database, sync, this.now);
    const masterSnapshotStore = new SqliteMasterSnapshotStore(database, this.now);
    const saleStore = new SqliteSaleStore(database, sync, this.now);
    // `SqliteCashShiftStore` satisface `CashPort` estructuralmente: Payments no
    // escribe caja, y `cash/` no importa de `payments/` (`DEC-016` §10).
    const paymentStore = new SqlitePaymentStore(database, sync, cashShiftStore, this.now);

    this.state = {
      sessionStore,
      sessionActivation: new SessionActivationService(verifier, sessionStore),
      authorizationStore: new SqliteAuthorizationSnapshotStore(database, this.now),
      openCashShift: new OpenCashShiftUseCase(masterSnapshotStore, cashShiftStore, this.now),
      closeCashShift: new CloseCashShiftUseCase(cashShiftStore, this.now),
      createSale: new CreateSaleUseCase(new SandboxCatalogStore(database), saleStore, this.now),
      registerCashPayment: new RegisterCashPaymentUseCase(paymentStore, this.now),
      registerTransferPayment: new RegisterTransferPaymentUseCase(paymentStore, this.now),
      confirmTransferPayment: new ConfirmTransferPaymentUseCase(paymentStore, this.now),
      cancelPayment: new CancelPaymentUseCase(paymentStore, this.now),
      getPayment: new GetPaymentUseCase(paymentStore, this.now),
    };
  }

  async stop(): Promise<void> {
    // Los vínculos mueren con el componente: no existe sesión vinculada a un
    // servicio detenido.
    this.bindings.clear();
    this.state = undefined;
  }

  /** Binding de dispositivo derivado de la configuración local, nunca del llamador. */
  deviceBinding(): { installationId: string; deviceId: string } {
    return { installationId: this.config.installation_id, deviceId: this.config.device_id };
  }
}
