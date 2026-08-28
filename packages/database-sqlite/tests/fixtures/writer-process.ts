import { LocalDatabase } from "../../src/index.js";

const dataDirectory = process.argv[2];
if (!dataDirectory) throw new Error("data directory argument is required");

const database = LocalDatabase.open({ dataDirectory });
process.stdout.write("READY\n");

const shutdown = () => {
  database.close();
  process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

setInterval(() => undefined, 60_000);
