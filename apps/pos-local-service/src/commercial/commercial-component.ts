import { SqliteWaitingCartStore } from "../sales/sqlite-waiting-cart-store.js";
import type {PublicLicenseCatalog} from "@pos-platform/contracts";
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
import {boundIdentityFromClaims} from "../session/session-binding-registry.js";
import {SignedSessionAssertionSchema,SignedAuthorizationSnapshotSchema} from "@pos-platform/contracts";
import { SqliteAuthorizationSnapshotStore } from "../authorization/sqlite-authorization-snapshot-store.js";
import {AuthorizationSnapshotVerifier} from "../security/authorization-snapshot-verifier.js";
import {assertAuthorizationTrustSeparated} from "../security/authorization-trust-separation.js";
import {SnapshotAcquisitionService} from "../authorization/snapshot-acquisition.js";
import type {SnapshotProvider} from "../authorization/snapshot-provider.js";
import type {SnapshotBinding} from "../authorization/authorization-snapshot-store.js";
import { SqliteMasterSnapshotStore } from "../master-data/sqlite-master-snapshot-store.js";
import { SqliteCashShiftStore } from "../cash/sqlite-cash-shift-store.js";
import { OpenCashShiftUseCase } from "../cash/open-cash-shift-use-case.js";
import { CloseCashShiftUseCase } from "../cash/close-cash-shift-use-case.js";
import { SqliteSaleStore } from "../sales/sqlite-sale-store.js";
import { SqliteCatalogStore } from "../catalog/sqlite-catalog-store.js";
import { RegisterProductUseCase } from "../catalog/register-product-use-case.js";
import { FindCatalogItemUseCase } from "../catalog/find-catalog-item-use-case.js";
import { ListCatalogItemsUseCase } from "../catalog/list-catalog-items-use-case.js";
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
import { SqliteCustomerStore } from "../customers/sqlite-customer-store.js";
import { RegisterCustomerUseCase } from "../customers/register-customer-use-case.js";
import { GetCustomerUseCase } from "../customers/get-customer-use-case.js";
import { CustomerMarketingSubscriptionStore } from "../customers/customer-marketing-subscription.js";
import { FiscalCredentialStore } from "../fiscal/fiscal-credential-store.js";
import { SecretStoreFactusCredentialResolver } from "../fiscal/factus-credential-resolver.js";
import { SqliteFiscalDocumentStore } from "../fiscal/sqlite-fiscal-document-store.js";
import { SqliteFiscalSaleSource } from "../fiscal/fiscal-sale-source.js";
import { IssueElectronicDocumentUseCase } from "../fiscal/issue-electronic-document-use-case.js";
import { SqliteAuditStore } from "../audit/sqlite-audit-store.js";
import { ListAuditEventsUseCase } from "../audit/list-audit-events-use-case.js";
import { SqliteAdminMetricsStore } from "../admin/sqlite-admin-metrics-store.js";
import { GetAdminMetricsUseCase } from "../admin/get-admin-metrics-use-case.js";
import { HardwareService } from "../hardware/hardware-service.js";
import type { CashRegisterLicenseGate } from "../security/license-capacity-gate.js";
import { HardwareStore } from "../hardware/hardware-store.js";
import { loadHardwareRegistry,loadAutomaticDrawerPolicy } from "../hardware/platform-transports.js";

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
  private hardwareInstance:HardwareService|null=null;
  get hardware():HardwareService {if(!this.hardwareInstance)throw new Error("HARDWARE_RUNTIME_NOT_STARTED");return this.hardwareInstance;}
  readonly name = "commercial";

  private state:
    | {
        readonly sessionStore: SqliteSessionAssertionStore;
        readonly sessionActivation: SessionActivationService;
        readonly authorizationStore: SqliteAuthorizationSnapshotStore;
        readonly openCashShift: OpenCashShiftUseCase;
        readonly closeCashShift: CloseCashShiftUseCase;
        readonly createSale: CreateSaleUseCase;
        readonly waitingCarts: SqliteWaitingCartStore;
        readonly registerCashPayment: RegisterCashPaymentUseCase;
        readonly registerTransferPayment: RegisterTransferPaymentUseCase;
        readonly confirmTransferPayment: ConfirmTransferPaymentUseCase;
        readonly cancelPayment: CancelPaymentUseCase;
        readonly getPayment: GetPaymentUseCase;
        readonly registerCustomer: RegisterCustomerUseCase;
        readonly getCustomer: GetCustomerUseCase;
        readonly customerMarketing: CustomerMarketingSubscriptionStore;
        readonly registerProduct: RegisterProductUseCase;
        readonly findCatalogItem: FindCatalogItemUseCase;
        readonly listCatalogItems: ListCatalogItemsUseCase;
        readonly listAuditEvents: ListAuditEventsUseCase;
        readonly getAdminMetrics: GetAdminMetricsUseCase;
        readonly receiveStock: ReceiveStockUseCase;
        readonly adjustStock: AdjustStockUseCase;
        readonly getStock: GetStockUseCase;
        readonly getReceipt: GetReceiptUseCase;
        /**
         * `null` cuando la emisión fiscal no está configurada en este equipo:
         * falta `fiscal_environment` (`POS_FISCAL_ENVIRONMENT`) o no hay
         * credencial depositada para `(FACTUS, environment)`. El mismo criterio
         * de `D4`/`CentralSyncComponent` con `central_base_url` — ausencia
         * significa «esta pieza no está lista», no un error de arranque.
         */
        readonly issueElectronicDocument: IssueElectronicDocumentUseCase | null;
      }
    | undefined;

  readonly bindings: SessionBindingRegistry;
  private nativeSessionCloser:((connections:readonly string[],initiator:string)=>void)|undefined;

  registerNativeSessionCloser(close:(connections:readonly string[],initiator:string)=>void):()=>void{
    if(this.nativeSessionCloser)throw Error("NATIVE_SESSION_CLOSER_ALREADY_REGISTERED");
    this.nativeSessionCloser=close;
    return ()=>{if(this.nativeSessionCloser===close)this.nativeSessionCloser=undefined;};
  }

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly durableSync: DurableSyncComponent,
    private readonly sessionSigningKeys: ReadonlyMap<string, TrustedSigningKey> = new Map(),
    private readonly now: () => Date = () => new Date(),
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
    /** Separately provisioned authorization trust. SSA keys never imply SAS trust. */
    private readonly authorizationSigningKeys:ReadonlyMap<string,TrustedSigningKey>=new Map(),
    private readonly licenseGate?: CashRegisterLicenseGate,
    private readonly publicLicenseCatalog?:()=>Promise<PublicLicenseCatalog>,
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
  verifyNativeAuthorization(assertion:unknown,snapshot:unknown){
    assertAuthorizationTrustSeparated(this.authorizationSigningKeys,this.sessionSigningKeys);
    const ssa=SignedSessionAssertionSchema.parse(assertion),sas=SignedAuthorizationSnapshotSchema.parse(snapshot);
    if(this.sessionStore.isClosed(ssa.claims.session_id))throw Error("LOCAL_BUSINESS_SESSION_CLOSED");
    const binding={...this.deviceBinding(),userId:ssa.claims.user_id};
    const identity=new SessionAssertionVerifier(this.sessionSigningKeys,new TrustedClockGuard(this.localDatabase.database),this.now)
      .verify(ssa,binding);
    if(identity.decision!=="VALID")throw Error("NATIVE_SSA_REJECTED");
    const checked=new AuthorizationSnapshotVerifier(this.authorizationSigningKeys,new TrustedClockGuard(this.localDatabase.database),this.now).verify(sas,binding);
    if(checked.decision!=="VALID")throw Error("NATIVE_SAS_REJECTED");
    return {ssa,sas,binding};
  }
  activateNativeAuthorization(assertion:unknown,snapshot:unknown,connectionId:string){
    const {ssa,sas,binding}=this.verifyNativeAuthorization(assertion,snapshot);
    this.localDatabase.database.native.transaction(()=>{
      if(this.sessionActivation.activate(ssa,binding).kind!=="ACTIVATED")throw Error("NATIVE_SSA_REJECTED");
      if(this.authorizationStore.activate(sas,binding).kind!=="ACTIVATED")throw Error("NATIVE_SAS_SEQUENCE_REJECTED");
    })();
    this.bindings.bind(connectionId,boundIdentityFromClaims(ssa.claims));
  }
  closeNativeSession(connectionId:string):string|null{
    const bound=this.bindings.resolve(connectionId);if(!bound)return null;
    this.sessionStore.close(bound.ssaSessionId);
    const connections=this.bindings.releaseSession(bound.ssaSessionId);
    // The durable tombstone above commits before bindings or sockets are
    // released. Already committed effects remain subject to idempotency.
    this.nativeSessionCloser?.(connections,connectionId);
    return bound.ssaSessionId;
  }
  loadVerifiedAuthorization(binding:SnapshotBinding){
    try{assertAuthorizationTrustSeparated(this.authorizationSigningKeys,this.sessionSigningKeys);}catch{return null;}
    const stored=this.authorizationStore.loadActive(binding);if(!stored)return null;
    const verified=new AuthorizationSnapshotVerifier(this.authorizationSigningKeys,new TrustedClockGuard(this.localDatabase.database),this.now)
      .verify({claims:stored.claims,signature:stored.signature},binding);
    return verified.decision==="VALID"?stored:null;
  }
  async refreshAuthorization(provider:SnapshotProvider){
    assertAuthorizationTrustSeparated(this.authorizationSigningKeys,this.sessionSigningKeys);
    const {installationId,deviceId}=this.deviceBinding();
    const found=this.sessionStore.loadActiveByDevice(installationId,deviceId);
    if(found.kind!=="FOUND")throw Error("AUTHORIZATION_ACTIVE_SESSION_REQUIRED");
    const binding={installationId,deviceId,userId:found.session.claims.user_id};
    const verifier=new SessionAssertionVerifier(this.sessionSigningKeys,new TrustedClockGuard(this.localDatabase.database),this.now);
    if(verifier.verify({claims:found.session.claims,signature:found.session.signature},binding).decision!=="VALID")throw Error("AUTHORIZATION_VERIFIED_SESSION_REQUIRED");
    return new SnapshotAcquisitionService(provider,new AuthorizationSnapshotVerifier(this.authorizationSigningKeys,
      new TrustedClockGuard(this.localDatabase.database),this.now),this.authorizationStore).acquire(binding);
  }
  get openCashShift(): OpenCashShiftUseCase { return this.ready.openCashShift; }
  get closeCashShift(): CloseCashShiftUseCase { return this.ready.closeCashShift; }
  get waitingCarts(): SqliteWaitingCartStore { return this.ready.waitingCarts; }
  get createSale(): CreateSaleUseCase { return this.ready.createSale; }
  get registerCashPayment(): RegisterCashPaymentUseCase { return this.ready.registerCashPayment; }
  get registerTransferPayment(): RegisterTransferPaymentUseCase { return this.ready.registerTransferPayment; }
  get confirmTransferPayment(): ConfirmTransferPaymentUseCase { return this.ready.confirmTransferPayment; }
  get cancelPayment(): CancelPaymentUseCase { return this.ready.cancelPayment; }
  get getPayment(): GetPaymentUseCase { return this.ready.getPayment; }
  get registerCustomer(): RegisterCustomerUseCase { return this.ready.registerCustomer; }
  get getCustomer(): GetCustomerUseCase { return this.ready.getCustomer; }
  get customerMarketing(): CustomerMarketingSubscriptionStore { return this.ready.customerMarketing; }
  get registerProduct(): RegisterProductUseCase { return this.ready.registerProduct; }
  get findCatalogItem(): FindCatalogItemUseCase { return this.ready.findCatalogItem; }
  get listCatalogItems(): ListCatalogItemsUseCase { return this.ready.listCatalogItems; }
  get listAuditEvents(): ListAuditEventsUseCase { return this.ready.listAuditEvents; }
  readPublicLicenseCatalog(){if(!this.publicLicenseCatalog)throw Error("LICENSE_CATALOG_NOT_CONFIGURED");return this.publicLicenseCatalog();}

  get getAdminMetrics(): GetAdminMetricsUseCase { return this.ready.getAdminMetrics; }
  get receiveStock(): ReceiveStockUseCase { return this.ready.receiveStock; }
  get adjustStock(): AdjustStockUseCase { return this.ready.adjustStock; }
  get getStock(): GetStockUseCase { return this.ready.getStock; }
  get getReceipt(): GetReceiptUseCase { return this.ready.getReceipt; }
  get issueElectronicDocument(): IssueElectronicDocumentUseCase | null { return this.ready.issueElectronicDocument; }

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
    const auditStore = new SqliteAuditStore(database);
    const adminMetricsStore = new SqliteAdminMetricsStore(database);
    // `SqliteInventoryStore` satisface `InventoryPort` por la misma razón: la
    // venta saca la mercancía sin que `inventory/` conozca a `payments/`.
    const inventoryStore = new SqliteInventoryStore(database, sync, this.now);
    const paymentStore = new SqlitePaymentStore(database, sync, cashShiftStore, inventoryStore, this.now);
    const hardwareStore=new HardwareStore(database);
    hardwareStore.recoverInterrupted();
    this.hardwareInstance=new HardwareService(hardwareStore,new GetReceiptUseCase(new SqliteReceiptStore(database)),loadHardwareRegistry(this.config.hardware_profiles_file),undefined,loadAutomaticDrawerPolicy(this.config.hardware_automatic_drawer_policy_file));

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

    this.state = {
      issueElectronicDocument,
      sessionStore,
      sessionActivation: new SessionActivationService(verifier, sessionStore),
      authorizationStore: new SqliteAuthorizationSnapshotStore(database, this.now),
      openCashShift: new OpenCashShiftUseCase(masterSnapshotStore, cashShiftStore, this.now, this.licenseGate),
      closeCashShift: new CloseCashShiftUseCase(cashShiftStore, this.now),
      waitingCarts: new SqliteWaitingCartStore(database, this.now),
      createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashShiftStore, saleStore, this.now),
      receiveStock: new ReceiveStockUseCase(inventoryStore),
      adjustStock: new AdjustStockUseCase(inventoryStore),
      getStock: new GetStockUseCase(inventoryStore),
      // El recibo no escribe: su almacen solo lee la venta ya cobrada (`DEC-019`).
      getReceipt: new GetReceiptUseCase(new SqliteReceiptStore(database)),
      registerProduct: new RegisterProductUseCase(catalogStore),
      findCatalogItem: new FindCatalogItemUseCase(catalogStore),
      listCatalogItems: new ListCatalogItemsUseCase(catalogStore),
      listAuditEvents: new ListAuditEventsUseCase(auditStore),
      getAdminMetrics: new GetAdminMetricsUseCase(adminMetricsStore),
      registerCashPayment: new RegisterCashPaymentUseCase(paymentStore, this.now),
      registerTransferPayment: new RegisterTransferPaymentUseCase(paymentStore, this.now),
      confirmTransferPayment: new ConfirmTransferPaymentUseCase(paymentStore, this.now),
      cancelPayment: new CancelPaymentUseCase(paymentStore, this.now),
      getPayment: new GetPaymentUseCase(paymentStore, this.now),
      registerCustomer: new RegisterCustomerUseCase(customerStore),
      getCustomer: new GetCustomerUseCase(customerStore),
      customerMarketing: new CustomerMarketingSubscriptionStore(database, this.now),
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
