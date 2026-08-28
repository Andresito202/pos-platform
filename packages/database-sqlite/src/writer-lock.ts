import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type } from "node:fs";
import { join } from "node:path";

interface LockRecord { readonly pid: number; readonly token: string; readonly acquired_at: string; }

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

export class WriterLock {
  private released = false;
  private constructor(readonly path: string, private readonly token: string) {}

  static acquire(directory: string): WriterLock {
    const path = join(directory, "local-writer.lock");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = randomUUID();
      try {
        const descriptor = openSync(path, "wx", 0o600);
        try {
          const record: LockRecord = { pid: process.pid, token, acquired_at: new Date().toISOString() };
          writeFileSync(descriptor, JSON.stringify(record), { encoding: "utf8" });
        } finally { closeSync(descriptor); }
        return new WriterLock(path, token);
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
        let record: LockRecord;
        try { record = JSON.parse(readFileSync(path, "utf8")) as LockRecord; }
        catch { throw new Error("writer lock exists but is unreadable; manual recovery required"); }
        if (processIsAlive(record.pid)) throw new Error(`SQLite writer already active with pid ${record.pid}`);
        try { renameSync(path, `${path}.stale.${randomUUID()}`); }
        catch (renameError) {
          if (renameError && typeof renameError === "object" && "code" in renameError && renameError.code === "ENOENT") continue;
          throw renameError;
        }
      }
    }
    throw new Error("unable to acquire SQLite writer lock after contention");
  }

  release(): void {
    if (this.released) return;
    let record: LockRecord;
    try { record = JSON.parse(readFileSync(this.path, "utf8")) as LockRecord; }
    catch { throw new Error("writer lock ownership cannot be verified"); }
    if (record.token !== this.token || record.pid !== process.pid) throw new Error("writer lock ownership mismatch");
    unlinkSync(this.path);
    this.released = true;
  }
}
