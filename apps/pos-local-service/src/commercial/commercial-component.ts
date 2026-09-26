import { FactusAdapter, FetchHttpTransport, type DocumentIssuancePort } from "@pos-platform/fiscal-adapters";
import type { RuntimeComponent } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import type { DurableSyncComponent } from "../sync/durable-sync-component.js";
import type { ServiceConfig } from "../config.js";
import type { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
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
import { SetFiscalAttributeUseCase } from "../catalog/set-fiscal-attribute-use-case.js";
import { AddPresentationUseCase } from "../catalog/add-presentation-use-case.js";
import { DeclareConversionUseCase } from "../catalog/declare-conversion-use-case.js";
import { ApplyConversionUseCase } from "../inventory/apply-conversion-use-case.js";
import { FindCatalogItemUseCase } from "../catalog/find-catalog-item-use-case.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";
import { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../inventory/receive-stock-use-case.js";
import { ReceiveLotUseCase } from "../inventory/receive-lot-use-case.js";
import { ImportCatalogUseCase } from "../catalog/import-catalog-use-case.js";
import { AdjustStockUseCase } from "../inventory/adjust-stock-use-case.js";
import { GetStockUseCase } from "../inventory/get-stock-use-case.js";
import { TraceLotUseCase } from "../inventory/trace-lot-use-case.js";
import { ListExpiringLotsUseCase } from "../inventory/list-expiring-lots-use-case.js";
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
import { FiscalCredentialStore } from "../fiscal/fiscal-credential-store.js";
import { SecretStoreFactusCredentialResolver } from "../fiscal/factus-credential-resolver.js";
import { SqliteFiscalDocumentStore } from "../fiscal/sqlite-fiscal-document-store.js";
import { ListFiscalDocumentsUseCase } from "../fiscal/list-fiscal-documents-use-case.js";
import { SqliteFiscalSaleSource } from "../fiscal/fiscal-sale-source.js";
import { IssueElectronicDocumentUseCase } from "../fiscal/issue-electronic-document-use-case.js";

/**
 * Origen de las claves de firma de sesión.
 *
 * El mapa directo sirve a quien ya lo tiene resuelto; la función sirve a quien
 * lo lee de una tabla que aún no está abierta cuando se construye este
 * componente. `start()` la invoca una vez y no vuelve a consultarla: rotar un
 * ancla exige reiniciar el servicio, que es exactamente la ceremonia que
 * `DEC-011` describe para una rotación.
 */
export type SessionSigningKeySource =
  | ReadonlyMap<string, TrustedSigningKey>
  | (() => ReadonlyMap<string, TrustedSigningKey>);

/**
 * Componente que reúne la superficie comercial V1 — `DEC-014` / `DEC-015`.
 *
 * No implementa reglas de negocio: construye los casos de uso ya materializados
 * en `BLOQUE 4C` y `BLOQUE 4D` y sostiene el registro de vínculos de sesión.
 * Ningún archivo de `cash/` ni de `sales/` se modifica para exponerlos.
 *
 * ## Claves de firma
 *
 * `sessionSigningKeys` se inyecta y admite dos formas: un mapa ya resuelto
 * —como lo pasan las pruebas— o una función que lo resuelve. La función existe
 * porque el origen real es una tabla: `main.ts` pasa
 * `() => security.trustAnchors.keysFor("SESSION_ASSERTION")` y los componentes
 * se construyen todos antes de que arranque ninguno, de modo que leer el ancla
 * en el constructor tocaría una base de datos que todavía no está abierta. Se
 * resuelve una sola vez, en `start()`, después de que `local-security` haya
 * arrancado.
 *
 * Que el origen exista no significa que haya claves. Mientras nadie
 * provisione un ancla —la carencia `LIC-003` / `DEV-003`, que `DEC-011`
 * mantiene `BLOCKED`— el mapa resuelto está vacío y `session.activate`
 * **falla cerrado**: una `key_id` desconocida se reporta como
 * `SIGNATURE_INVALID`. Se prefiere esa negativa a fabricar una confianza que
 * nadie ha provisto.
 */
export class CommercialComponent implements RuntimeComponent {
  readonly name = "commercial";

  private state:
    | {
        readonly sessionStore: SqliteSessionAssertionStore;
        readonly sessionActivation: SessionActivationService;
        readonly authorizationStore: SqliteAuthorizationSnapshotStore;
        readonly trustedClock: TrustedClockGuard;
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
        readonly setFiscalAttribute: SetFiscalAttributeUseCase;
        readonly addPresentation: AddPresentationUseCase;
        readonly declareConversion: DeclareConversionUseCase;
        readonly applyConversion: ApplyConversionUseCase;
        readonly findCatalogItem: FindCatalogItemUseCase;
        readonly receiveStock: ReceiveStockUseCase;
        readonly receiveLot: ReceiveLotUseCase;
        readonly importCatalog: ImportCatalogUseCase;
        readonly adjustStock: AdjustStockUseCase;
        readonly getStock: GetStockUseCase;
        readonly traceLot: TraceLotUseCase;
        readonly listExpiringLots: ListExpiringLotsUseCase;
        readonly getReceipt: GetReceiptUseCase;
        /**
         * `null` cuando la emisión fiscal no está configurada en este equipo:
         * falta `fiscal_environment` (`POS_FISCAL_ENVIRONMENT`) o no hay
         * credencial depositada para `(FACTUS, environment)`. El mismo criterio
         * de `D4`/`CentralSyncComponent` con `central_base_url` — ausencia
         * significa «esta pieza no está lista», no un error de arranque.
         */
        readonly issueElectronicDocument: IssueElectronicDocumentUseCase | null;
        readonly listFiscalDocuments: ListFiscalDocumentsUseCase;
      }
    | undefined;

  readonly bindings: SessionBindingRegistry;

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly durableSync: DurableSyncComponent,
    private readonly sessionSigningKeys: SessionSigningKeySource = new Map(),
    private readonly now: () => Date = () => new Date(),
    // Los tres son opcionales e independientes entre si: un equipo puede tener
    // adquiriente sin emision fiscal, emision fiscal sin adquiriente, o ninguno.
    private readonly paymentProvider?: PaymentProviderPort,
    /**
     * Almacén de secretos ya abierto con `fiscalCredentialContext` (`DEC-021`
     * F2) — construirlo aquí exigiría el mismo `keyProvider`/directorio que
     * `LocalSecurityComponent` ya abrió con OTRO contexto criptográfico, y
     * mezclar los dos rompería el aislamiento de `SEC-004`. `undefined`
     * significa «este equipo no tiene almacén de secretos fiscal», igual de
     * válido en pruebas que no ejercitan F4/F5.
     */
    private readonly fiscalSecretStore: EncryptedFileSecretStore | undefined = undefined,
    /** Inyección para pruebas: sin ella, producción construye `FactusAdapter` real. */
    private readonly issuancePortOverride: DocumentIssuancePort | undefined = undefined,
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
  get trustedClock(): TrustedClockGuard { return this.ready.trustedClock; }
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
  get setFiscalAttribute(): SetFiscalAttributeUseCase { return this.ready.setFiscalAttribute; }
  get addPresentation(): AddPresentationUseCase { return this.ready.addPresentation; }
  get declareConversion(): DeclareConversionUseCase { return this.ready.declareConversion; }
  get applyConversion(): ApplyConversionUseCase { return this.ready.applyConversion; }
  get findCatalogItem(): FindCatalogItemUseCase { return this.ready.findCatalogItem; }
  get receiveStock(): ReceiveStockUseCase { return this.ready.receiveStock; }
  get receiveLot(): ReceiveLotUseCase { return this.ready.receiveLot; }
  get importCatalog(): ImportCatalogUseCase { return this.ready.importCatalog; }
  get adjustStock(): AdjustStockUseCase { return this.ready.adjustStock; }
  get getStock(): GetStockUseCase { return this.ready.getStock; }
  get traceLot(): TraceLotUseCase { return this.ready.traceLot; }
  get listExpiringLots(): ListExpiringLotsUseCase { return this.ready.listExpiringLots; }
  get getReceipt(): GetReceiptUseCase { return this.ready.getReceipt; }
  get issueElectronicDocument(): IssueElectronicDocumentUseCase | null { return this.ready.issueElectronicDocument; }
  get listFiscalDocuments(): ListFiscalDocumentsUseCase { return this.ready.listFiscalDocuments; }

  async start(): Promise<void> {
    const database = this.localDatabase.database;
    const sync = this.durableSync.store;

    const sessionStore = new SqliteSessionAssertionStore(database, this.now);
    // Un solo guardián de reloj por base: el aprovisionamiento de `DEC-025`
    // verifica el snapshot con este mismo, en vez de abrir un segundo sobre el
    // mismo estado persistido.
    const trustedClock = new TrustedClockGuard(database);
    const verifier = new SessionAssertionVerifier(
      typeof this.sessionSigningKeys === "function"
        ? this.sessionSigningKeys()
        : this.sessionSigningKeys,
      trustedClock,
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

    // `DEC-021` F5. Sin almacén de secretos fiscal o sin ambiente configurado,
    // la pieza no se construye — `fiscal.document.issue` falla cerrado con un
    // motivo (`FISCAL_NOT_CONFIGURED`), nunca inventando un adapter sin
    // credencial. Con ambos presentes pero **sin credencial depositada aún**
    // (F2 es una operación de operador, separada de este arranque), tampoco:
    // el criterio es el mismo, «no está lista», no un fallo de arranque.
    let issueElectronicDocument: IssueElectronicDocumentUseCase | null = null;
    if (this.fiscalSecretStore !== undefined && this.config.fiscal_environment !== undefined) {
      const environment = this.config.fiscal_environment;
      const fiscalCredentialStore = new FiscalCredentialStore(this.fiscalSecretStore);
      if (fiscalCredentialStore.has("FACTUS", environment)) {
        const credential = fiscalCredentialStore.reference("FACTUS", environment);
        const issuancePort = this.issuancePortOverride ?? new FactusAdapter(
          new FetchHttpTransport(),
          new SecretStoreFactusCredentialResolver(fiscalCredentialStore),
          environment,
          { now: () => this.now().getTime() },
        );
        issueElectronicDocument = new IssueElectronicDocumentUseCase(
          new SqliteFiscalSaleSource(database),
          catalogStore,
          new SqliteFiscalDocumentStore(database, this.now),
          issuancePort,
          credential,
          this.now,
        );
      }
    }

    // Se izan los tres que la importación compone, para que **reutilice las
    // mismas instancias** en vez de crear copias suyas: un segundo escritor de
    // catálogo acabaría admitiendo lo que el primero rechaza.
    const registerProduct = new RegisterProductUseCase(catalogStore);
    const setFiscalAttribute = new SetFiscalAttributeUseCase(catalogStore);
    const receiveStock = new ReceiveStockUseCase(inventoryStore);

    this.state = {
      issueElectronicDocument,
      // Siempre presente: leer lo ya emitido no depende de tener credencial.
      listFiscalDocuments: new ListFiscalDocumentsUseCase(new SqliteFiscalDocumentStore(database, this.now)),
      sessionStore,
      sessionActivation: new SessionActivationService(verifier, sessionStore),
      authorizationStore: new SqliteAuthorizationSnapshotStore(database, this.now),
      trustedClock,
      openCashShift: new OpenCashShiftUseCase(masterSnapshotStore, cashShiftStore, this.now),
      closeCashShift: new CloseCashShiftUseCase(cashShiftStore, this.now),
      createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashShiftStore, saleStore, this.now),
      receiveStock,
      receiveLot: new ReceiveLotUseCase(inventoryStore),
      importCatalog: new ImportCatalogUseCase(registerProduct, setFiscalAttribute, receiveStock),
      adjustStock: new AdjustStockUseCase(inventoryStore),
      getStock: new GetStockUseCase(inventoryStore),
      traceLot: new TraceLotUseCase(inventoryStore),
      listExpiringLots: new ListExpiringLotsUseCase(inventoryStore),
      // El recibo no escribe: su almacen solo lee la venta ya cobrada (`DEC-019`).
      getReceipt: new GetReceiptUseCase(new SqliteReceiptStore(database)),
      registerProduct,
      setFiscalAttribute,
      addPresentation: new AddPresentationUseCase(catalogStore),
      declareConversion: new DeclareConversionUseCase(catalogStore),
      applyConversion: new ApplyConversionUseCase(catalogStore, inventoryStore),
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
