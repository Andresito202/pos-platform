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
import { SqliteCatalogStore } from "../catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../catalog/register-product-use-case.js";
import { FindCatalogItemUseCase } from "../catalog/find-catalog-item-use-case.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";
import { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../inventory/receive-stock-use-case.js";
import { AdjustStockUseCase } from "../inventory/adjust-stock-use-case.js";
import { GetStockUseCase } from "../inventory/get-stock-use-case.js";
import { GetReceiptUseCase } from "../receipts/get-receipt-use-case.js";
import { SqliteReceiptStore } from "../receipts/sqlite-receipt-store.js";
import { SqlitePaymentStore } from "../payments/sqlite-payment-store.js";
import { RegisterCashPaymentUseCase } from "../payments/register-cash-payment-use-case.js";
import { RegisterTransferPaymentUseCase } from "../payments/register-transfer-payment-use-case.js";
import { ConfirmTransferPaymentUseCase } from "../payments/confirm-transfer-payment-use-case.js";
import { CancelPaymentUseCase } from "../payments/cancel-payment-use-case.js";
import { GetPaymentUseCase } from "../payments/get-payment-use-case.js";
import { ConfirmProviderPaymentUseCase } from "../payments/confirm-provider-payment-use-case.js";
import { RegisterQrPaymentUseCase } from "../payments/register-qr-payment-use-case.js";
import { ResolveUncertainProviderPaymentUseCase } from "../payments/resolve-uncertain-provider-payment-use-case.js";
import { SweepUncertainProviderPaymentsUseCase } from "../payments/sweep-uncertain-provider-payments-use-case.js";
import { QueryProviderForUncertainPaymentUseCase } from "../payments/query-provider-for-uncertain-payment-use-case.js";
import type { PaymentProviderPort } from "../payments/payment-provider-port.js";
import { SqliteCustomerStore } from "../customers/sqlite-customer-store.js";
import { SqliteCreditStore } from "../credit/sqlite-credit-store.js";
import { OpenCreditAccountUseCase } from "../credit/open-credit-account-use-case.js";
import { GetCreditAccountUseCase } from "../credit/get-credit-account-use-case.js";
import { RegisterCreditPaymentUseCase } from "../credit/register-credit-payment-use-case.js";
import { RegisterCreditRepaymentUseCase } from "../credit/register-credit-repayment-use-case.js";
import { RegisterCustomerUseCase } from "../customers/register-customer-use-case.js";
import { GetCustomerUseCase } from "../customers/get-customer-use-case.js";

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
        readonly confirmProviderPayment: ConfirmProviderPaymentUseCase;
        readonly registerQrPayment: RegisterQrPaymentUseCase | undefined;
        readonly sweepUncertainProviderPayments: SweepUncertainProviderPaymentsUseCase | undefined;
        readonly queryProviderForUncertainPayment: QueryProviderForUncertainPaymentUseCase | undefined;
        readonly openCreditAccount: OpenCreditAccountUseCase;
        readonly getCreditAccount: GetCreditAccountUseCase;
        readonly registerCreditPayment: RegisterCreditPaymentUseCase;
        readonly registerCreditRepayment: RegisterCreditRepaymentUseCase;
        readonly registerCustomer: RegisterCustomerUseCase;
        readonly getCustomer: GetCustomerUseCase;
        readonly registerProduct: RegisterProductUseCase;
        readonly findCatalogItem: FindCatalogItemUseCase;
        readonly receiveStock: ReceiveStockUseCase;
        readonly adjustStock: AdjustStockUseCase;
        readonly getStock: GetStockUseCase;
        readonly getReceipt: GetReceiptUseCase;
      }
    | undefined;

  readonly bindings: SessionBindingRegistry;

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly durableSync: DurableSyncComponent,
    private readonly sessionSigningKeys: ReadonlyMap<string, TrustedSigningKey> = new Map(),
    private readonly now: () => Date = () => new Date(),
    private readonly paymentProvider?: PaymentProviderPort,
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
  get confirmProviderPayment(): ConfirmProviderPaymentUseCase { return this.ready.confirmProviderPayment; }
  get registerQrPayment(): RegisterQrPaymentUseCase | undefined { return this.ready.registerQrPayment; }
  /**
   * `undefined` mientras no haya `PaymentProviderPort`: sin proveedor no hay a
   * quién preguntar, igual que no hay cobro QR que registrar.
   */
  get sweepUncertainProviderPayments(): SweepUncertainProviderPaymentsUseCase | undefined {
    return this.ready.sweepUncertainProviderPayments;
  }
  /** La consulta puntual, sobre el mismo proveedor y la misma resolución. */
  get queryProviderForUncertainPayment(): QueryProviderForUncertainPaymentUseCase | undefined {
    return this.ready.queryProviderForUncertainPayment;
  }
  get openCreditAccount(): OpenCreditAccountUseCase { return this.ready.openCreditAccount; }
  get getCreditAccount(): GetCreditAccountUseCase { return this.ready.getCreditAccount; }
  get registerCreditPayment(): RegisterCreditPaymentUseCase { return this.ready.registerCreditPayment; }
  get registerCreditRepayment(): RegisterCreditRepaymentUseCase { return this.ready.registerCreditRepayment; }
  get registerCustomer(): RegisterCustomerUseCase { return this.ready.registerCustomer; }
  get getCustomer(): GetCustomerUseCase { return this.ready.getCustomer; }
  get registerProduct(): RegisterProductUseCase { return this.ready.registerProduct; }
  get findCatalogItem(): FindCatalogItemUseCase { return this.ready.findCatalogItem; }
  get receiveStock(): ReceiveStockUseCase { return this.ready.receiveStock; }
  get adjustStock(): AdjustStockUseCase { return this.ready.adjustStock; }
  get getStock(): GetStockUseCase { return this.ready.getStock; }
  get getReceipt(): GetReceiptUseCase { return this.ready.getReceipt; }

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
    const customerStore = new SqliteCustomerStore(database, sync, this.now);
    const catalogStore = new SqliteCatalogStore(database, sync, this.now);
    // `SqliteInventoryStore` satisface `InventoryPort` por la misma razón: la
    // venta saca la mercancía sin que `inventory/` conozca a `payments/`.
    const inventoryStore = new SqliteInventoryStore(database, sync, this.now);
    // `SqliteCashShiftStore` satisface también `CreditCashPort`: el abono en
    // efectivo entra al cajón por el mismo puerto, con otro motivo.
    const creditStore = new SqliteCreditStore(database, sync, cashShiftStore, this.now);
    // El crédito entra en Payments por un puerto, igual que caja e inventario:
    // `credit/` nunca importa de `payments/`.
    const paymentStore = new SqlitePaymentStore(
      database, sync, cashShiftStore, inventoryStore, this.now, creditStore,
    );
    const confirmProviderPayment = new ConfirmProviderPaymentUseCase(paymentStore);
    // Una sola resolución para las dos vías que pueden traer evidencia del
    // proveedor. No hay un segundo camino por el que un `UNKNOWN` acabe
    // resuelto: la consulta puntual y el barrido desembocan en este objeto.
    const resolveUncertainProviderPayment = new ResolveUncertainProviderPaymentUseCase(
      paymentStore, confirmProviderPayment,
    );

    this.state = {
      sessionStore,
      sessionActivation: new SessionActivationService(verifier, sessionStore),
      authorizationStore: new SqliteAuthorizationSnapshotStore(database, this.now),
      openCashShift: new OpenCashShiftUseCase(masterSnapshotStore, cashShiftStore, this.now),
      closeCashShift: new CloseCashShiftUseCase(cashShiftStore, this.now),
      createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashShiftStore, saleStore, this.now),
      receiveStock: new ReceiveStockUseCase(inventoryStore),
      adjustStock: new AdjustStockUseCase(inventoryStore),
      getStock: new GetStockUseCase(inventoryStore),
      // El recibo no escribe: su almacen solo lee la venta ya cobrada (`DEC-019`).
      getReceipt: new GetReceiptUseCase(new SqliteReceiptStore(database)),
      registerProduct: new RegisterProductUseCase(catalogStore),
      findCatalogItem: new FindCatalogItemUseCase(catalogStore),
      registerCashPayment: new RegisterCashPaymentUseCase(paymentStore, this.now),
      registerTransferPayment: new RegisterTransferPaymentUseCase(paymentStore, this.now),
      confirmTransferPayment: new ConfirmTransferPaymentUseCase(paymentStore, this.now),
      cancelPayment: new CancelPaymentUseCase(paymentStore, this.now),
      getPayment: new GetPaymentUseCase(paymentStore, this.now),
      confirmProviderPayment,
      registerQrPayment: this.paymentProvider === undefined
        ? undefined
        : new RegisterQrPaymentUseCase(paymentStore, this.paymentProvider),
      // El barrido se monta sobre las mismas piezas que ya existen: el mismo
      // almacén, el mismo proveedor y la misma resolución. No hay una segunda
      // vía por la que un `UNKNOWN` pueda acabar resuelto.
      sweepUncertainProviderPayments: this.paymentProvider === undefined
        ? undefined
        : new SweepUncertainProviderPaymentsUseCase(
            paymentStore,
            this.paymentProvider,
            resolveUncertainProviderPayment,
            this.now,
          ),
      queryProviderForUncertainPayment: this.paymentProvider === undefined
        ? undefined
        : new QueryProviderForUncertainPaymentUseCase(
            paymentStore,
            this.paymentProvider,
            resolveUncertainProviderPayment,
          ),
      registerCustomer: new RegisterCustomerUseCase(customerStore),
      openCreditAccount: new OpenCreditAccountUseCase(creditStore, this.now),
      getCreditAccount: new GetCreditAccountUseCase(creditStore, this.now),
      registerCreditPayment: new RegisterCreditPaymentUseCase(paymentStore, this.now),
      registerCreditRepayment: new RegisterCreditRepaymentUseCase(creditStore, this.now),
      getCustomer: new GetCustomerUseCase(customerStore),
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
