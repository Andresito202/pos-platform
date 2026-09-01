import type { RuntimeComponent } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import type { DurableSyncComponent } from "../sync/durable-sync-component.js";
import { OperationConfirmationStore } from "./operation-confirmation-store.js";

export class OperationConfirmationComponent implements RuntimeComponent {
  readonly name = "operation-confirmation";
  private storeValue: OperationConfirmationStore | undefined;

  constructor(
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly durableSync: DurableSyncComponent,
  ) {}

  get store(): OperationConfirmationStore {
    if (!this.storeValue) throw new Error("operation confirmation store is not ready");
    return this.storeValue;
  }

  async start(): Promise<void> {
    this.storeValue = new OperationConfirmationStore(this.localDatabase.database, this.durableSync.store);
  }

  async stop(): Promise<void> {
    this.storeValue = undefined;
  }
}
