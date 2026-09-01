import type { RuntimeComponent } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import { DurableSyncStore, type RetryPolicy } from "./durable-sync-store.js";

export class DurableSyncComponent implements RuntimeComponent {
  readonly name = "durable-sync";
  private storeValue: DurableSyncStore | undefined;

  constructor(
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly retryPolicy?: RetryPolicy,
  ) {}

  get store(): DurableSyncStore {
    if (!this.storeValue) throw new Error("durable sync is not ready");
    return this.storeValue;
  }

  async start(): Promise<void> {
    const store = new DurableSyncStore(this.localDatabase.database, this.retryPolicy);
    store.recoverInterruptedDispatches();
    this.storeValue = store;
  }

  async stop(): Promise<void> {
    this.storeValue = undefined;
  }
}
