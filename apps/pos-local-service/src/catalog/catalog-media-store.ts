import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
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

/**
 * Media payloads live on disk under the installation data directory.
 * SQLite keeps only verified references — never embeds image bytes in catalog list.
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

  private resolveSafe(relpath: string): string {
    const root = resolve(this.mediaRoot());
    const absolute = resolve(root, relpath);
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new Error("MEDIA_PATH_ESCAPE");
    }
    return absolute;
  }

  put(input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly actorId: string;
    readonly bytes: Buffer;
  }):
    | { readonly kind: "STORED"; readonly media: CatalogMediaRecord }
    | { readonly kind: "INVALID"; readonly reason: string } {
    const validated = validateCatalogMediaBytes(input.bytes);
    if (!validated.ok) return { kind: "INVALID", reason: validated.reason };

    const sha = createHash("sha256").update(input.bytes).digest("hex");
    const id = randomUUID();
    const ext = validated.mime === "image/png" ? "png" : validated.mime === "image/webp" ? "webp" : "jpg";
    const relpath = join(input.tenantId, input.companyId, `${sha}.${ext}`).split("\\").join("/");
    const absolute = this.resolveSafe(relpath);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    if (!existsSync(absolute)) {
      writeFileSync(absolute, input.bytes, { flag: "wx", mode: 0o600 });
      chmodSync(absolute, 0o600);
    }

    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `INSERT INTO catalog_media(
        id, tenant_id, company_id, content_sha256, mime_type, byte_size,
        width_px, height_px, storage_relpath, status, created_by_actor_id, created_at, retired_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,NULL)`,
    ).run(
      id, input.tenantId, input.companyId, sha, validated.mime, input.bytes.length,
      validated.width, validated.height, relpath, input.actorId, nowIso,
    );

    return {
      kind: "STORED",
      media: {
        id,
        mimeType: validated.mime,
        byteSize: input.bytes.length,
        widthPx: validated.width,
        heightPx: validated.height,
        contentSha256: sha,
      },
    };
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
    const absolute = this.resolveSafe(row.storage_relpath);
    if (!existsSync(absolute)) return null;
    const bytes = readFileSync(absolute);
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

  retire(tenantId: string, companyId: string, mediaId: string): boolean {
    const nowIso = this.now().toISOString();
    const result = this.database.native.prepare(
      `UPDATE catalog_media
       SET status='RETIRED', retired_at=?
       WHERE tenant_id=? AND company_id=? AND id=? AND status='ACTIVE'`,
    ).run(nowIso, tenantId, companyId, mediaId);
    return result.changes === 1;
  }
}
