import { LocalDatabase } from "../../src/index.js";

const dataDirectory = process.argv[2];
if (!dataDirectory) throw new Error("data directory argument is required");

const database = LocalDatabase.open({ dataDirectory });
database.native.prepare("INSERT INTO runtime_operations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
  "018f0000-0000-7000-8000-000000000001",
  "crash-recovery:01",
  "c".repeat(64),
  "SUCCEEDED",
  "COMMITTED",
  "2026-08-28T00:00:00Z",
  "2026-08-28T00:00:00Z",
);
process.stdout.write("READY\n");

const shutdown = () => {
  database.close();
  process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

setInterval(() => undefined, 60_000);
