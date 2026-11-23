import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync,
  unlinkSync, renameSync, readdirSync, statSync, rmSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  validateCatalogMediaBytes,
  type CatalogMediaMime,
} from "./catalog-media-validate.js";

export interface CatalogMediaRecord {
  readonly id: string;
  readonly mimeType: CatalogMediaMime;
  readonly byteSize: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly contentSha256: string;
}

export interface StagedCatalogMedia {
  readonly stagingId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly actorId: string;
  readonly mimeType: CatalogMediaMime;
  readonly byteSize: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly contentSha256: string;
  readonly stagingRelpath: string;
}

/**
 * Media payloads live on disk under the installation data directory.
 * SQLite keeps only verified ACTIVE references — never embeds image bytes in
 * catalog list. Staging → confirm avoids orphan ACTIVE rows when attach fails.
 */
export class CatalogMediaStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly dataDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private mediaRoot(): string {
    return join(this.dataDirectory, "catalog-media");
  }

  private stagingRoot(): string {
    return join(this.dataDirectory, "catalog-media-staging");
  }

  private resolveSafe(rootDir: string, relpath: string): string {
    const root = resolve(rootDir);
    const absolute = resolve(root, relpath);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new Error("MEDIA_PATH_ESCAPE");
    }
    return absolute;
  }

  private extFor(mime: CatalogMediaMime): string {
    return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  }

  private finalRelpath(
    tenantId: string,
    companyId: string,
    sha: string,
    mime: CatalogMediaMime,
  ): string {
    return join(tenantId, companyId, `${sha}.${this.extFor(mime)}`).split("\\").join("/");
  }

  /**
   * Writes validated bytes to a provisional path. No SQLite ACTIVE row yet.
   */
  stage(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly actorId: string;
    readonly bytes: Buffer;
  }):
    | { readonly kind: "STAGED"; readonly staged: StagedCatalogMedia }
    | { readonly kind: "INVALID"; readonly reason: string } {
    const validated = validateCatalogMediaBytes(input.bytes);
    if (!validated.ok) return { kind: "INVALID", reason: validated.reason };

    const sha = createHash("sha256").update(input.bytes).digest("hex");
    const stagingId = randomUUID();
    const relpath = join(
      input.tenantId,
      input.companyId,
      `${stagingId}.${this.extFor(validated.mime)}`,
    ).split("\\").join("/");
    const absolute = this.resolveSafe(this.stagingRoot(), relpath);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    writeFileSync(absolute, input.bytes, { flag: "wx", mode: 0o600 });
    chmodSync(absolute, 0o600);

    return {
      kind: "STAGED",
      staged: {
        stagingId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorId: input.actorId,
        mimeType: validated.mime,
        byteSize: input.bytes.length,
        widthPx: validated.width,
        heightPx: validated.height,
        contentSha256: sha,
        stagingRelpath: relpath,
      },
    };
  }

  abandonStaged(staged: StagedCatalogMedia): void {
    const absolute = this.resolveSafe(this.stagingRoot(), staged.stagingRelpath);
    if (existsSync(absolute)) {
      try { unlinkSync(absolute); } catch { /* best-effort cleanup */ }
    }
  }

  /**
   * Promotes a staged file into an ACTIVE catalog_media row and final path.
   * Call only after product attach preconditions are known good, or inside a
   * caller that retires on subsequent attach failure.
   */
  confirmStaged(staged: StagedCatalogMedia):
    | { readonly kind: "STORED"; readonly media: CatalogMediaRecord }
    | { readonly kind: "INVALID"; readonly reason: string } {
    const stagingAbsolute = this.resolveSafe(this.stagingRoot(), staged.stagingRelpath);
    if (!existsSync(stagingAbsolute)) {
      return { kind: "INVALID", reason: "IMAGE_STAGING_MISSING" };
    }
    const bytes = readFileSync(stagingAbsolute);
    const revalidated = validateCatalogMediaBytes(bytes);
    if (!revalidated.ok) {
      this.abandonStaged(staged);
      return { kind: "INVALID", reason: revalidated.reason };
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== staged.contentSha256) {
      this.abandonStaged(staged);
      return { kind: "INVALID", reason: "IMAGE_INTEGRITY_MISMATCH" };
    }

    const finalRel = this.finalRelpath(
      staged.tenantId, staged.companyId, sha, staged.mimeType,
    );
    const finalAbsolute = this.resolveSafe(this.mediaRoot(), finalRel);
    mkdirSync(dirname(finalAbsolute), { recursive: true, mode: 0o700 });
    if (!existsSync(finalAbsolute)) {
      try {
        renameSync(stagingAbsolute, finalAbsolute);
      } catch {
        writeFileSync(finalAbsolute, bytes, { flag: "wx", mode: 0o600 });
        try { unlinkSync(stagingAbsolute); } catch { /* staging leftover reclaimable */ }
      }
      chmodSync(finalAbsolute, 0o600);
    } else {
      try { unlinkSync(stagingAbsolute); } catch { /* shared content — staging only */ }
    }

    const id = randomUUID();
    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `INSERT INTO catalog_media(
        id, tenant_id, company_id, content_sha256, mime_type, byte_size,
        width_px, height_px, storage_relpath, status, created_by_actor_id, created_at, retired_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,NULL)`,
    ).run(
      id, staged.tenantId, staged.companyId, sha, staged.mimeType, staged.byteSize,
      staged.widthPx, staged.heightPx, finalRel, staged.actorId, nowIso,
    );

    return {
      kind: "STORED",
      media: {
        id,
        mimeType: staged.mimeType,
        byteSize: staged.byteSize,
        widthPx: staged.widthPx,
        heightPx: staged.heightPx,
        contentSha256: sha,
      },
    };
  }

  /**
   * Retires an ACTIVE media row and deletes the file only when no other ACTIVE
   * row still references the same content path.
   */
  retire(tenantId: string, companyId: string, mediaId: string): boolean {
    const nowIso = this.now().toISOString();
    const row = this.database.native.prepare(
      `SELECT storage_relpath FROM catalog_media
       WHERE tenant_id=? AND company_id=? AND id=? AND status='ACTIVE'`,
    ).get(tenantId, companyId, mediaId) as { storage_relpath: string } | undefined;
    if (row === undefined) return false;

    const result = this.database.native.prepare(
      `UPDATE catalog_media
       SET status='RETIRED', retired_at=?
       WHERE tenant_id=? AND company_id=? AND id=? AND status='ACTIVE'`,
    ).run(nowIso, tenantId, companyId, mediaId);
    if (result.changes !== 1) return false;

    const stillReferenced = this.database.native.prepare(
      `SELECT 1 AS ok FROM catalog_media
       WHERE tenant_id=? AND company_id=? AND storage_relpath=? AND status='ACTIVE'
       LIMIT 1`,
    ).get(tenantId, companyId, row.storage_relpath) as { ok: number } | undefined;
    if (stillReferenced === undefined) {
      const absolute = this.resolveSafe(this.mediaRoot(), row.storage_relpath);
      if (existsSync(absolute)) {
        try { unlinkSync(absolute); } catch { /* reclaim later */ }
      }
    }
    return true;
  }

  /**
   * Removes ACTIVE media that was never attached to a product (failed attach
   * after confirm) and deletes unreferenced files. Safe across companies.
   */
  reclaimOrphans(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly mediaId?: string;
  }): { readonly retired: number; readonly stagingRemoved: number } {
    let retired = 0;
    const orphans = this.database.native.prepare(
      `SELECT m.id AS id
       FROM catalog_media m
       WHERE m.tenant_id=? AND m.company_id=? AND m.status='ACTIVE'
         AND (? IS NULL OR m.id=?)
         AND NOT EXISTS (
           SELECT 1 FROM catalog_product p
           WHERE p.tenant_id=m.tenant_id AND p.company_id=m.company_id
             AND p.primary_media_id=m.id
         )`,
    ).all(
      input.tenantId,
      input.companyId,
      input.mediaId ?? null,
      input.mediaId ?? null,
    ) as Array<{ id: string }>;

    for (const orphan of orphans) {
      if (this.retire(input.tenantId, input.companyId, orphan.id)) retired += 1;
    }

    let stagingRemoved = 0;
    const stagingCompany = join(this.stagingRoot(), input.tenantId, input.companyId);
    if (existsSync(stagingCompany)) {
      for (const name of readdirSync(stagingCompany)) {
        const absolute = this.resolveSafe(stagingCompany, name);
        try {
          const ageMs = Date.now() - statSync(absolute).mtimeMs;
          // Recover crash leftovers; keep very recent staging (in-flight put).
          if (ageMs > 60_000) {
            unlinkSync(absolute);
            stagingRemoved += 1;
          }
        } catch { /* ignore */ }
      }
      try {
        if (readdirSync(stagingCompany).length === 0) rmSync(stagingCompany, { recursive: true });
      } catch { /* ignore */ }
    }
    return { retired, stagingRemoved };
  }

  getActive(
    tenantId: string,
    companyId: string,
    mediaId: string,
  ): { readonly record: CatalogMediaRecord; readonly bytes: Buffer } | null {
    const row = this.database.native.prepare(
      `SELECT id, mime_type, byte_size, width_px, height_px, content_sha256, storage_relpath
       FROM catalog_media
       WHERE tenant_id=? AND company_id=? AND id=? AND status='ACTIVE'`,
    ).get(tenantId, companyId, mediaId) as {
      id: string; mime_type: CatalogMediaMime; byte_size: number;
      width_px: number; height_px: number; content_sha256: string; storage_relpath: string;
    } | undefined;
    if (row === undefined) return null;
    const absolute = this.resolveSafe(this.mediaRoot(), row.storage_relpath);
    if (!existsSync(absolute)) return null;
    const bytes = readFileSync(absolute);
    const validated = validateCatalogMediaBytes(bytes);
    if (!validated.ok) return null;
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== row.content_sha256) return null;
    return {
      record: {
        id: row.id,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        widthPx: row.width_px,
        heightPx: row.height_px,
        contentSha256: row.content_sha256,
      },
      bytes,
    };
  }
}
