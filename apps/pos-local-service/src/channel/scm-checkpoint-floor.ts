import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const NAME = "scm-central-checkpoint.floor";

export type ScmCheckpointFloorSnapshot = {
  readonly trust_revision: number;
  readonly authority_spki_sha256: string;
};

/** Plain high-water companion to the encrypted checkpoint secret.
 * Deleting only the encrypted floor must not admit a colder live checkpoint. */
export class ScmCheckpointFloorMarker {
  constructor(private readonly directory: string) {
    if (!directory) throw new Error("SCM_CHECKPOINT_FLOOR_DIRECTORY_REQUIRED");
  }

  private path(): string {
    return join(this.directory, NAME);
  }

  has(): boolean {
    const target = this.path();
    if (!existsSync(target)) return false;
    if (lstatSync(target).isSymbolicLink()) throw new Error("SCM_CHECKPOINT_FLOOR_SYMLINK");
    return true;
  }

  read(): ScmCheckpointFloorSnapshot {
    const target = this.path();
    if (lstatSync(target).isSymbolicLink()) throw new Error("SCM_CHECKPOINT_FLOOR_SYMLINK");
    const value = JSON.parse(readFileSync(target, "utf8")) as ScmCheckpointFloorSnapshot;
    if (!Number.isSafeInteger(value.trust_revision) || value.trust_revision < 1 ||
        typeof value.authority_spki_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.authority_spki_sha256)) {
      throw new Error("SCM_CHECKPOINT_FLOOR_CORRUPT");
    }
    return Object.freeze({
      trust_revision: value.trust_revision,
      authority_spki_sha256: value.authority_spki_sha256,
    });
  }

  write(snapshot: ScmCheckpointFloorSnapshot): void {
    if (!Number.isSafeInteger(snapshot.trust_revision) || snapshot.trust_revision < 1 ||
        !/^[a-f0-9]{64}$/.test(snapshot.authority_spki_sha256)) {
      throw new Error("SCM_CHECKPOINT_FLOOR_REJECTED");
    }
    const target = this.path();
    const temporary = `${target}.tmp.${randomUUID()}`;
    const body = JSON.stringify({
      trust_revision: snapshot.trust_revision,
      authority_spki_sha256: snapshot.authority_spki_sha256,
    });
    writeFileSync(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temporary, target);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* ignore */ }
      throw error;
    }
  }
}

/** In-memory floor for isolated unit tests. */
export class MemoryScmCheckpointFloorMarker {
  private value: ScmCheckpointFloorSnapshot | undefined;
  has(): boolean { return this.value !== undefined; }
  read(): ScmCheckpointFloorSnapshot {
    if (!this.value) throw new Error("SCM_CHECKPOINT_FLOOR_MISSING");
    return this.value;
  }
  write(snapshot: ScmCheckpointFloorSnapshot): void {
    this.value = Object.freeze({ ...snapshot });
  }
}

export type ScmCheckpointFloor = Pick<ScmCheckpointFloorMarker, "has" | "read" | "write">;
