import { HardwareService } from "../hardware/hardware-service.js";
import { HardwareStore } from "../hardware/hardware-store.js";
import { loadHardwareRegistry, loadAutomaticDrawerPolicy } from "../hardware/platform-transports.js";
import { WindowsCh340Transport, loadWindowsScaleProfile } from "../hardware/windows-ch340-transport.js";
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
import { UpdateProductUseCase } from "../catalog/update-product-use-case.js";
import { SupersedePriceUseCase } from "../catalog/supersede-price-use-case.js";
import { ManageCatalogMediaUseCase } from "../catalog/manage-catalog-media-use-case.js";
import { CatalogMediaStore } from "../catalog/catalog-media-store.js";
import { FindCatalogItemUseCase } from "../catalog/find-catalog-item-use-case.js";
import { ListCatalogItemsUseCase } from "../catalog/list-catalog-items-use-case.js";
import { AddPresentationUseCase, UpsertFoodPolicyUseCase } from "../catalog/add-presentation-use-case.js";
import { ExecuteTransformUseCase } from "../inventory/execute-transform-use-case.js";
import { SqlitePharmacyStore } from "../pharmacy/sqlite-pharmacy-store.js";
import {
  UpsertPharmacyEstablishmentUseCase,
  UpsertPharmacyProfileUseCase,
  RegisterPharmacyPrescriptionUseCase,
  RegisterPharmacyTechnicalReceiptUseCase,
  RegisterPharmacySanitaryAlertUseCase,
} from "../pharmacy/pharmacy-use-cases.js";
import { SqliteBakeryStore } from "../bakery/sqlite-bakery-store.js";
import {
  UpsertBakeryIngredientProfileUseCase,
  UpsertBakeryFinishedPolicyUseCase,
  CreateBakeryRecipeDraftUseCase,
  ApproveBakeryRecipeUseCase,
  RecordBakeryLotAcquisitionCostUseCase,
  CreateBakeryProductionOrderUseCase,
  PlanBakeryProductionOrderUseCase,
  CancelBakeryProductionOrderUseCase,
  AuthorizeBakeryProductionDeviationUseCase,
  ConfirmBakeryProductionUseCase,
  ReleaseBakeryFinishedLotUseCase,
  GetBakeryProductionTraceUseCase,
} from "../bakery/bakery-use-cases.js";
import type { CashRegisterLicenseGate, SectorLicenseGate } from "../security/license-capacity-gate.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

import { SqliteAdminMetricsStore } from "../admin/sqlite-admin-metrics-store.js";
import { GetAdminMetricsUseCase } from "../admin/get-admin-metrics-use-case.js";
import { SqliteWaitingCartStore } from "../sales/sqlite-waiting-cart-store.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";
import { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import { ReceiveStockUseCase } from "../inventory/receive-stock-use-case.js";
import { AdjustStockUseCase,ChangeBatchStatusUseCase } from "../inventory/adjust-stock-use-case.js";
import { GetStockUseCase,ListBatchesUseCase } from "../inventory/get-stock-use-case.js";
import { ApprovePresentationConversionUseCase,ConvertPresentationUseCase } from "../inventory/presentation-conversion-use-cases.js";
import { CreateInventoryReservationUseCase,ReleaseInventoryReservationUseCase } from "../inventory/reservation-use-cases.js";
import { GetReceiptUseCase } from "../receipts/get-receipt-use-case.js";
import { SqliteReceiptStore } from "../receipts/sqlite-receipt-store.js";
import { SqlitePaymentStore } from "../payments/sqlite-payment-store.js";
import { RegisterFactusPayCollectionUseCase } from "../payments/register-factus-pay-collection-use-case.js";
import { VerifyFactusPayCollectionUseCase } from "../payments/verify-factus-pay-collection-use-case.js";
import { ResumeFactusPayCollectionUseCase } from "../payments/resume-factus-pay-collection-use-case.js";
import { FactusPayClient } from "../payments/factus-pay-client.js";
import { FactusPayCredentialStore } from "../payments/factus-pay-credential-store.js";
import { RegisterCashPaymentUseCase } from "../payments/register-cash-payment-use-case.js";
import { RegisterTransferPaymentUseCase } from "../payments/register-transfer-payment-use-case.js";
import { ConfirmTransferPaymentUseCase } from "../payments/confirm-transfer-payment-use-case.js";
import { CancelPaymentUseCase } from "../payments/cancel-payment-use-case.js";
import { GetPaymentUseCase } from "../payments/get-payment-use-case.js";
import { SqliteCustomerStore } from "../customers/sqlite-customer-store.js";
import { RegisterCustomerUseCase } from "../customers/register-customer-use-case.js";
import { GetCustomerUseCase } from "../customers/get-customer-use-case.js";
import { FiscalCredentialStore } from "../fiscal/fiscal-credential-store.js";
import { SecretStoreFactusCredentialResolver } from "../fiscal/factus-credential-resolver.js";
import { SqliteFiscalDocumentStore } from "../fiscal/sqlite-fiscal-document-store.js";
import { SqliteFiscalSaleSource } from "../fiscal/fiscal-sale-source.js";
import { IssueElectronicDocumentUseCase } from "../fiscal/issue-electronic-document-use-case.js";
import { SynchronizeNumberingRangesUseCase } from "../fiscal/synchronize-numbering-ranges-use-case.js";
import type { CredentialReference, NumberingRangePort } from "@pos-platform/fiscal-adapters";

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
  private hardwareInstance: HardwareService | null = null;
  private scaleInstance: WindowsCh340Transport | null = null;
  get scale(): WindowsCh340Transport | null { return this.scaleInstance; }
  hasOpenScaleRegister(registerId: string): boolean {
    return this.localDatabase.database.native.prepare("SELECT 1 FROM cash_shift WHERE tenant_id=? AND company_id=? AND branch_id=? AND cash_register_id=? AND status='OPEN'").get(this.config.tenant_id,this.config.company_id,this.config.branch_id,registerId) !== undefined;
  }
  get hardware(): HardwareService {
    if (!this.hardwareInstance) throw new Error("HARDWARE_RUNTIME_NOT_STARTED");
    return this.hardwareInstance;
  }
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
        readonly registerFactusPayCollection: RegisterFactusPayCollectionUseCase;
        readonly verifyFactusPayCollection: VerifyFactusPayCollectionUseCase;
        readonly resumeFactusPayCollection: ResumeFactusPayCollectionUseCase;
        readonly cancelPayment: CancelPaymentUseCase;
        readonly getPayment: GetPaymentUseCase;
        readonly registerCustomer: RegisterCustomerUseCase;
        readonly getCustomer: GetCustomerUseCase;
        readonly registerProduct: RegisterProductUseCase;
        readonly updateProduct: UpdateProductUseCase;
        readonly supersedePrice: SupersedePriceUseCase;
        readonly manageCatalogMedia: ManageCatalogMediaUseCase;
        readonly findCatalogItem: FindCatalogItemUseCase;
        readonly listCatalogItems: ListCatalogItemsUseCase;
        readonly receiveStock: ReceiveStockUseCase;
        readonly adjustStock: AdjustStockUseCase;
        readonly getStock: GetStockUseCase;
        readonly listBatches: ListBatchesUseCase;
        readonly changeBatchStatus: ChangeBatchStatusUseCase;
        readonly approvePresentationConversion: ApprovePresentationConversionUseCase;
        readonly convertPresentation: ConvertPresentationUseCase;
        readonly createInventoryReservation: CreateInventoryReservationUseCase;
        readonly releaseInventoryReservation: ReleaseInventoryReservationUseCase;
        readonly executeTransform: ExecuteTransformUseCase;
        readonly pharmacyStore: SqlitePharmacyStore;
        readonly upsertPharmacyEstablishment: UpsertPharmacyEstablishmentUseCase;
        readonly upsertPharmacyProfile: UpsertPharmacyProfileUseCase;
        readonly registerPharmacyPrescription: RegisterPharmacyPrescriptionUseCase;
        readonly registerPharmacyTechnicalReceipt: RegisterPharmacyTechnicalReceiptUseCase;
        readonly registerPharmacySanitaryAlert: RegisterPharmacySanitaryAlertUseCase;
        readonly bakeryStore: SqliteBakeryStore;
        readonly upsertBakeryIngredientProfile: UpsertBakeryIngredientProfileUseCase;
        readonly upsertBakeryFinishedPolicy: UpsertBakeryFinishedPolicyUseCase;
        readonly createBakeryRecipeDraft: CreateBakeryRecipeDraftUseCase;
        readonly approveBakeryRecipe: ApproveBakeryRecipeUseCase;
        readonly recordBakeryLotAcquisitionCost: RecordBakeryLotAcquisitionCostUseCase;
        readonly createBakeryProductionOrder: CreateBakeryProductionOrderUseCase;
        readonly planBakeryProductionOrder: PlanBakeryProductionOrderUseCase;
        readonly cancelBakeryProductionOrder: CancelBakeryProductionOrderUseCase;
        readonly authorizeBakeryProductionDeviation: AuthorizeBakeryProductionDeviationUseCase;
        readonly confirmBakeryProduction: ConfirmBakeryProductionUseCase;
        readonly releaseBakeryFinishedLot: ReleaseBakeryFinishedLotUseCase;
        readonly getBakeryProductionTrace: GetBakeryProductionTraceUseCase;
        readonly addPresentation: AddPresentationUseCase;
        readonly upsertFoodPolicy: UpsertFoodPolicyUseCase;
        readonly getAdminMetrics: GetAdminMetricsUseCase;
        readonly waitingCarts: SqliteWaitingCartStore;
        readonly getReceipt: GetReceiptUseCase;
        /**
         * `null` cuando la emisión fiscal no está configurada en este equipo:
         * falta `fiscal_environment` (`POS_FISCAL_ENVIRONMENT`) o no hay
         * credencial depositada para `(FACTUS, environment)`. El mismo criterio
         * de `D4`/`CentralSyncComponent` con `central_base_url` — ausencia
         * significa «esta pieza no está lista», no un error de arranque.
         */
        readonly issueElectronicDocument: IssueElectronicDocumentUseCase | null;
        readonly fiscalSaleSource: SqliteFiscalSaleSource;
        readonly synchronizeNumberingRanges: SynchronizeNumberingRangesUseCase | null;
        readonly fiscalCredentialReference: CredentialReference | null;
      }
    | undefined;

  readonly bindings: SessionBindingRegistry;

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
    private readonly licenseGate?: CashRegisterLicenseGate,
    private readonly sectorLicenseGate?: SectorLicenseGate,
    private readonly licenseEntitlementsReader?: (scope: SyncScope) => readonly string[],
    /**
     * Almacén abierto con `factusPayCredentialContext` (AAD distinto del fiscal).
     * `undefined` → Caja responde `FACTUS_PAY_NOT_CONFIGURED` sin inventar cliente.
     */
    private readonly factusPaySecretStore: EncryptedFileSecretStore | undefined = undefined,
  ) {
    this.bindings = new SessionBindingRegistry(now);
  }

  private installationScope(): SyncScope {
    return {
      tenantId: this.config.tenant_id,
      companyId: this.config.company_id,
      branchId: this.config.branch_id,
      installationId: this.config.installation_id,
      deviceId: this.config.device_id,
    };
  }

  /**
   * Fail-closed sector gate when a capacity provision is wired.
   * Tests without a provision leave the gate undefined and skip the check.
   */
  requireSectorEntitlement(entitlement: string): string | null {
    if (!this.sectorLicenseGate) return null;
    return this.sectorLicenseGate(this.installationScope(), entitlement);
  }

  listLicenseEntitlements(): readonly string[] {
    if (!this.licenseEntitlementsReader) return [];
    return this.licenseEntitlementsReader(this.installationScope());
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
  get registerFactusPayCollection(): RegisterFactusPayCollectionUseCase { return this.ready.registerFactusPayCollection; }
  get verifyFactusPayCollection(): VerifyFactusPayCollectionUseCase { return this.ready.verifyFactusPayCollection; }
  get resumeFactusPayCollection(): ResumeFactusPayCollectionUseCase { return this.ready.resumeFactusPayCollection; }
  get cancelPayment(): CancelPaymentUseCase { return this.ready.cancelPayment; }
  get getPayment(): GetPaymentUseCase { return this.ready.getPayment; }
  get registerCustomer(): RegisterCustomerUseCase { return this.ready.registerCustomer; }
  get getCustomer(): GetCustomerUseCase { return this.ready.getCustomer; }
  get registerProduct(): RegisterProductUseCase { return this.ready.registerProduct; }
  get updateProduct(): UpdateProductUseCase { return this.ready.updateProduct; }
  get supersedePrice(): SupersedePriceUseCase { return this.ready.supersedePrice; }
  get manageCatalogMedia(): ManageCatalogMediaUseCase { return this.ready.manageCatalogMedia; }
  get findCatalogItem(): FindCatalogItemUseCase { return this.ready.findCatalogItem; }
  get listCatalogItems(): ListCatalogItemsUseCase { return this.ready.listCatalogItems; }
  get receiveStock(): ReceiveStockUseCase { return this.ready.receiveStock; }
  get adjustStock(): AdjustStockUseCase { return this.ready.adjustStock; }
  get getStock(): GetStockUseCase { return this.ready.getStock; }
  get listBatches(): ListBatchesUseCase { return this.ready.listBatches; }
  get changeBatchStatus(): ChangeBatchStatusUseCase { return this.ready.changeBatchStatus; }
  get approvePresentationConversion(): ApprovePresentationConversionUseCase { return this.ready.approvePresentationConversion; }
  get convertPresentation(): ConvertPresentationUseCase { return this.ready.convertPresentation; }
  get createInventoryReservation(): CreateInventoryReservationUseCase { return this.ready.createInventoryReservation; }
  get releaseInventoryReservation(): ReleaseInventoryReservationUseCase { return this.ready.releaseInventoryReservation; }
  get executeTransform(): ExecuteTransformUseCase { return this.ready.executeTransform; }
  get pharmacyStore(): SqlitePharmacyStore { return this.ready.pharmacyStore; }
  get upsertPharmacyEstablishment(): UpsertPharmacyEstablishmentUseCase { return this.ready.upsertPharmacyEstablishment; }
  get upsertPharmacyProfile(): UpsertPharmacyProfileUseCase { return this.ready.upsertPharmacyProfile; }
  get registerPharmacyPrescription(): RegisterPharmacyPrescriptionUseCase { return this.ready.registerPharmacyPrescription; }
  get registerPharmacyTechnicalReceipt(): RegisterPharmacyTechnicalReceiptUseCase { return this.ready.registerPharmacyTechnicalReceipt; }
  get registerPharmacySanitaryAlert(): RegisterPharmacySanitaryAlertUseCase { return this.ready.registerPharmacySanitaryAlert; }
  get bakeryStore(): SqliteBakeryStore { return this.ready.bakeryStore; }
  get upsertBakeryIngredientProfile(): UpsertBakeryIngredientProfileUseCase { return this.ready.upsertBakeryIngredientProfile; }
  get upsertBakeryFinishedPolicy(): UpsertBakeryFinishedPolicyUseCase { return this.ready.upsertBakeryFinishedPolicy; }
  get createBakeryRecipeDraft(): CreateBakeryRecipeDraftUseCase { return this.ready.createBakeryRecipeDraft; }
  get approveBakeryRecipe(): ApproveBakeryRecipeUseCase { return this.ready.approveBakeryRecipe; }
  get recordBakeryLotAcquisitionCost(): RecordBakeryLotAcquisitionCostUseCase { return this.ready.recordBakeryLotAcquisitionCost; }
  get createBakeryProductionOrder(): CreateBakeryProductionOrderUseCase { return this.ready.createBakeryProductionOrder; }
  get planBakeryProductionOrder(): PlanBakeryProductionOrderUseCase { return this.ready.planBakeryProductionOrder; }
  get cancelBakeryProductionOrder(): CancelBakeryProductionOrderUseCase { return this.ready.cancelBakeryProductionOrder; }
  get authorizeBakeryProductionDeviation(): AuthorizeBakeryProductionDeviationUseCase { return this.ready.authorizeBakeryProductionDeviation; }
  get confirmBakeryProduction(): ConfirmBakeryProductionUseCase { return this.ready.confirmBakeryProduction; }
  get releaseBakeryFinishedLot(): ReleaseBakeryFinishedLotUseCase { return this.ready.releaseBakeryFinishedLot; }
  get getBakeryProductionTrace(): GetBakeryProductionTraceUseCase { return this.ready.getBakeryProductionTrace; }
  get addPresentation(): AddPresentationUseCase { return this.ready.addPresentation; }
  get upsertFoodPolicy(): UpsertFoodPolicyUseCase { return this.ready.upsertFoodPolicy; }
  get getAdminMetrics(): GetAdminMetricsUseCase { return this.ready.getAdminMetrics; }
  get waitingCarts(): SqliteWaitingCartStore { return this.ready.waitingCarts; }
  get getReceipt(): GetReceiptUseCase { return this.ready.getReceipt; }
  get issueElectronicDocument(): IssueElectronicDocumentUseCase | null { return this.ready.issueElectronicDocument; }
  get fiscalSaleSource(): SqliteFiscalSaleSource { return this.ready.fiscalSaleSource; }
  get synchronizeNumberingRanges(): SynchronizeNumberingRangesUseCase | null { return this.ready.synchronizeNumberingRanges; }
  get fiscalCredentialReference(): CredentialReference | null { return this.ready.fiscalCredentialReference; }

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
    const pharmacyStore = new SqlitePharmacyStore(database, sync, this.now);
    const inventoryStore = new SqliteInventoryStore(database, sync, this.now);
    const bakeryStore = new SqliteBakeryStore(database, sync, inventoryStore, this.now);
    const paymentStore = new SqlitePaymentStore(database, sync, cashShiftStore, inventoryStore, this.now, pharmacyStore);

    // `DEC-021` F5. Sin almacén de secretos fiscal o sin ambiente configurado,
    // la pieza no se construye — `fiscal.document.issue` falla cerrado con un
    // motivo (`FISCAL_NOT_CONFIGURED`), nunca inventando un adapter sin
    // credencial. Con ambos presentes pero **sin credencial depositada aún**
    // (F2 es una operación de operador, separada de este arranque), tampoco:
    // el criterio es el mismo, «no está lista», no un fallo de arranque.
    const fiscalSaleSource = new SqliteFiscalSaleSource(database);
    let issueElectronicDocument: IssueElectronicDocumentUseCase | null = null;
    let synchronizeNumberingRanges: SynchronizeNumberingRangesUseCase | null = null;
    let fiscalCredentialReference: CredentialReference | null = null;
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
          fiscalSaleSource,
          catalogStore,
          new SqliteFiscalDocumentStore(database, this.now),
          issuancePort,
          credential,
          this.now,
        );
        fiscalCredentialReference = credential;
        if ("synchronizeRanges" in issuancePort) {
          synchronizeNumberingRanges = new SynchronizeNumberingRangesUseCase(issuancePort as NumberingRangePort,new SqliteFiscalDocumentStore(database,this.now),this.now);
        }
      }
    }

    const hardwareStore = new HardwareStore(database);
    hardwareStore.recoverInterrupted();
    this.hardwareInstance = new HardwareService(hardwareStore, new GetReceiptUseCase(new SqliteReceiptStore(database)), loadHardwareRegistry(this.config.hardware_profiles_file), undefined, loadAutomaticDrawerPolicy(this.config.hardware_automatic_drawer_policy_file));
    const scaleProfile = loadWindowsScaleProfile(this.config.windows_scale_profile_file);
    this.scaleInstance = scaleProfile ? new WindowsCh340Transport(scaleProfile) : null;
    const factusPayClient = this.factusPaySecretStore === undefined
      ? null
      : new FactusPayClient(
        new FactusPayCredentialStore(this.factusPaySecretStore, this.config.company_id),
        "SANDBOX",
        this.now,
      );

    this.state = {
      issueElectronicDocument,
      fiscalSaleSource,
      synchronizeNumberingRanges,
      fiscalCredentialReference,
      sessionStore,
      sessionActivation: new SessionActivationService(verifier, sessionStore),
      authorizationStore: new SqliteAuthorizationSnapshotStore(database, this.now),
      openCashShift: new OpenCashShiftUseCase(masterSnapshotStore, cashShiftStore, this.now),
      closeCashShift: new CloseCashShiftUseCase(cashShiftStore, this.now),
      createSale: new CreateSaleUseCase(catalogStore, inventoryStore, cashShiftStore, saleStore, this.now, pharmacyStore),
      upsertPharmacyEstablishment: new UpsertPharmacyEstablishmentUseCase(pharmacyStore),
      upsertPharmacyProfile: new UpsertPharmacyProfileUseCase(pharmacyStore),
      registerPharmacyPrescription: new RegisterPharmacyPrescriptionUseCase(pharmacyStore),
      registerPharmacyTechnicalReceipt: new RegisterPharmacyTechnicalReceiptUseCase(pharmacyStore, inventoryStore),
      registerPharmacySanitaryAlert: new RegisterPharmacySanitaryAlertUseCase(pharmacyStore, inventoryStore),
      pharmacyStore,
      bakeryStore,
      upsertBakeryIngredientProfile: new UpsertBakeryIngredientProfileUseCase(bakeryStore),
      upsertBakeryFinishedPolicy: new UpsertBakeryFinishedPolicyUseCase(bakeryStore),
      createBakeryRecipeDraft: new CreateBakeryRecipeDraftUseCase(bakeryStore),
      approveBakeryRecipe: new ApproveBakeryRecipeUseCase(bakeryStore),
      recordBakeryLotAcquisitionCost: new RecordBakeryLotAcquisitionCostUseCase(bakeryStore),
      createBakeryProductionOrder: new CreateBakeryProductionOrderUseCase(bakeryStore),
      planBakeryProductionOrder: new PlanBakeryProductionOrderUseCase(bakeryStore),
      cancelBakeryProductionOrder: new CancelBakeryProductionOrderUseCase(bakeryStore),
      authorizeBakeryProductionDeviation: new AuthorizeBakeryProductionDeviationUseCase(bakeryStore),
      confirmBakeryProduction: new ConfirmBakeryProductionUseCase(bakeryStore),
      releaseBakeryFinishedLot: new ReleaseBakeryFinishedLotUseCase(bakeryStore),
      getBakeryProductionTrace: new GetBakeryProductionTraceUseCase(bakeryStore),
      receiveStock: new ReceiveStockUseCase(inventoryStore),
      adjustStock: new AdjustStockUseCase(inventoryStore),
      getStock: new GetStockUseCase(inventoryStore),
      listBatches: new ListBatchesUseCase(inventoryStore),
      changeBatchStatus: new ChangeBatchStatusUseCase(inventoryStore),
      approvePresentationConversion: new ApprovePresentationConversionUseCase(inventoryStore),
      convertPresentation: new ConvertPresentationUseCase(inventoryStore),
      createInventoryReservation: new CreateInventoryReservationUseCase(inventoryStore),
      releaseInventoryReservation: new ReleaseInventoryReservationUseCase(inventoryStore),
      executeTransform: new ExecuteTransformUseCase(inventoryStore),
      getAdminMetrics: new GetAdminMetricsUseCase(new SqliteAdminMetricsStore(database)),
      waitingCarts: new SqliteWaitingCartStore(database, this.now),
      // El recibo no escribe: su almacen solo lee la venta ya cobrada (`DEC-019`).
      getReceipt: new GetReceiptUseCase(new SqliteReceiptStore(database)),
      registerProduct: new RegisterProductUseCase(catalogStore),
      updateProduct: new UpdateProductUseCase(catalogStore),
      supersedePrice: new SupersedePriceUseCase(catalogStore),
      manageCatalogMedia: new ManageCatalogMediaUseCase(
        catalogStore,
        new CatalogMediaStore(database, this.config.data_directory, this.now),
      ),
      addPresentation: new AddPresentationUseCase(catalogStore),
      upsertFoodPolicy: new UpsertFoodPolicyUseCase(catalogStore),
      findCatalogItem: new FindCatalogItemUseCase(catalogStore, inventoryStore, pharmacyStore),
      listCatalogItems: new ListCatalogItemsUseCase(catalogStore, inventoryStore, pharmacyStore),
      registerCashPayment: new RegisterCashPaymentUseCase(paymentStore, this.now),
      registerTransferPayment: new RegisterTransferPaymentUseCase(paymentStore, this.now),
      confirmTransferPayment: new ConfirmTransferPaymentUseCase(paymentStore, this.now),
      registerFactusPayCollection: new RegisterFactusPayCollectionUseCase(paymentStore, factusPayClient, this.now),
      verifyFactusPayCollection: new VerifyFactusPayCollectionUseCase(paymentStore, factusPayClient, this.now),
      resumeFactusPayCollection: new ResumeFactusPayCollectionUseCase(paymentStore, factusPayClient, this.now),
      cancelPayment: new CancelPaymentUseCase(paymentStore, this.now),
      getPayment: new GetPaymentUseCase(paymentStore, this.now),
      registerCustomer: new RegisterCustomerUseCase(customerStore),
      getCustomer: new GetCustomerUseCase(customerStore),
    };
    this.scaleInstance?.start();
  }

  async stop(): Promise<void> {
    await this.scaleInstance?.stop();
    this.scaleInstance = null;
    // Los vínculos mueren con el componente: no existe sesión vinculada a un
    // servicio detenido.
    this.bindings.clear();
    this.state = undefined;
    this.hardwareInstance = null;
  }

  /** Binding de dispositivo derivado de la configuración local, nunca del llamador. */
  deviceBinding(): { installationId: string; deviceId: string } {
    return { installationId: this.config.installation_id, deviceId: this.config.device_id };
  }
}
