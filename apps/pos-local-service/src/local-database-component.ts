import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { RuntimeComponent } from "./lifecycle.js";

export class LocalDatabaseComponent implements RuntimeComponent {
  readonly name = "local-database";
  private databaseValue: LocalDatabase | undefined;
  constructor(private readonly dataDirectory: string) {}
  get database(): LocalDatabase {
    if (!this.databaseValue) throw new Error("local database is not ready");
    return this.databaseValue;
  }
  async start(): Promise<void> { this.databaseValue = LocalDatabase.open({ dataDirectory: this.dataDirectory }); }
  async stop(): Promise<void> { this.databaseValue?.close(); this.databaseValue = undefined; }
}
