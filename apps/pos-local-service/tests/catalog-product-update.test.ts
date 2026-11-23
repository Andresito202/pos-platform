import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { readCatalogAvailability } from "../src/catalog/catalog-availability.js";
import { CatalogMediaStore } from "../src/catalog/catalog-media-store.js";
import { ManageCatalogMediaUseCase } from "../src/catalog/manage-catalog-media-use-case.js";
import { RegisterProductUseCase } from "../src/catalog/register-product-use-case.js";
import { SqliteCatalogStore } from "../src/catalog/sqlite-catalog-store.js";
import { SupersedePriceUseCase } from "../src/catalog/supersede-price-use-case.js";
import { UpdateProductUseCase } from "../src/catalog/update-product-use-case.js";
import { validateCatalogMediaBytes } from "../src/catalog/catalog-media-validate.js";
import { ReceiveStockUseCase } from "../src/inventory/receive-stock-use-case.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const OTHER_COMPANY = "018f0000-0000-7000-8000-0000000000aa";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc01";
const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const OTHER_SCOPE: SyncScope = { ...SCOPE, companyId: OTHER_COMPANY };
const NOW = new Date("2026-09-07T10:00:00.000Z");

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep real failure */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[], companyId = COMPANY): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-01T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: companyId, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Deterministic 32×32 RGB PNG within catalog media bounds. */
function solidPng32(rgb: [number, number, number] = [40, 120, 200]): Buffer {
  const width = 32;
  const height = 32;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-catalog-update-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const sync = new DurableSyncStore(database);
  const catalogStore = new SqliteCatalogStore(database, sync, () => NOW);
  const inventoryStore = new SqliteInventoryStore(database, sync, () => NOW);
  const mediaStore = new CatalogMediaStore(database, dir, () => NOW);
  const registered = new RegisterProductUseCase(catalogStore).execute(
    SCOPE, SESSION, auth(["CATALOG_PRODUCT_REGISTER"]), {
      code: "EDIT-001",
      name: "Producto editable",
      stockControlled: true,
      presentationName: "Unidad",
      unitCode: "UND",
      unitPrecision: 0,
      barcode: "7701234567001",
      priceAmount: "1500.000000",
      currencyCode: "COP",
      idempotencyKey: "reg:edit-001",
      correlationId: CORRELATION,
      causationId: null,
    },
  );
  if (registered.kind !== "REGISTERED") throw new Error(registered.kind);
  return {
    dir,
    database,
    catalogStore,
    inventoryStore,
    mediaStore,
    productId: registered.productId,
    presentationId: registered.presentationId,
    update: new UpdateProductUseCase(catalogStore),
    price: new SupersedePriceUseCase(catalogStore),
    media: new ManageCatalogMediaUseCase(catalogStore, mediaStore),
    receive: new ReceiveStockUseCase(inventoryStore),
    register: new RegisterProductUseCase(catalogStore),
  };
}

describe("UC-CAT-002 product update", () => {
  it("updates commercial fields with permission and rejects without it", async () => {
    const { update, productId, presentationId, catalogStore } = await buildEnv();
    const denied = update.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_READ"]), {
        productId,
        expectedVersion: 1,
        name: "Nuevo nombre",
        idempotencyKey: "upd:denied",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(denied.kind).toBe("UNAUTHORIZED");

    const ok = update.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_UPDATE"]), {
        productId,
        expectedVersion: 1,
        name: "Café molido",
        code: "EDIT-001B",
        presentationId,
        presentationExpectedVersion: 1,
        presentationName: "Paquete",
        barcode: "7701234567002",
        idempotencyKey: "upd:ok",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(ok).toMatchObject({ kind: "UPDATED", version: 2, presentationVersion: 2 });
    const product = catalogStore.findActiveProduct(SCOPE, productId);
    expect(product?.name).toBe("Café molido");
    expect(product?.code).toBe("EDIT-001B");
    const presentation = catalogStore.findActivePresentation(SCOPE, presentationId);
    expect(presentation?.name).toBe("Paquete");
    expect(presentation?.barcode).toBe("7701234567002");
  });

  it("rejects concurrent version conflicts and duplicate identifiers", async () => {
    const { update, register, productId, presentationId } = await buildEnv();
    const second = register.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_REGISTER"]), {
        code: "EDIT-002",
        name: "Otro",
        stockControlled: true,
        presentationName: "Unidad",
        unitCode: "UND",
        unitPrecision: 0,
        barcode: "7701234567099",
        priceAmount: "1000.000000",
        currencyCode: "COP",
        idempotencyKey: "reg:edit-002",
        correlationId: CORRELATION,
        causationId: null,
      },
    );
    expect(second.kind).toBe("REGISTERED");

    const conflict = update.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_UPDATE"]), {
        productId,
        expectedVersion: 99,
        name: "Conflicto",
        idempotencyKey: "upd:conflict",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(conflict).toMatchObject({ kind: "VERSION_CONFLICT", currentVersion: 1 });

    const duplicateCode = update.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_UPDATE"]), {
        productId,
        expectedVersion: 1,
        code: "EDIT-002",
        idempotencyKey: "upd:dup-code",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(duplicateCode.kind).toBe("CODE_ALREADY_REGISTERED");

    const duplicateBarcode = update.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_UPDATE"]), {
        productId,
        expectedVersion: 1,
        presentationId,
        presentationExpectedVersion: 1,
        barcode: "7701234567099",
        idempotencyKey: "upd:dup-bar",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(duplicateBarcode.kind).toBe("BARCODE_ALREADY_REGISTERED");
  });

  it("isolates updates to the authorized company", async () => {
    const { update, productId } = await buildEnv();
    const foreign = update.execute(
      OTHER_SCOPE, SESSION, auth(["CATALOG_PRODUCT_UPDATE"], OTHER_COMPANY), {
        productId,
        expectedVersion: 1,
        name: "Ajeno",
        idempotencyKey: "upd:foreign",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(foreign.kind).toBe("NOT_FOUND");
  });

  it("publishes a superseding price without mutating stock", async () => {
    const { price, presentationId, inventoryStore, receive } = await buildEnv();
    expect(receive.execute(SCOPE, SESSION, auth(["INVENTORY_STOCK_RECEIVE"]), {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "5.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:price",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");

    const denied = price.execute(
      SCOPE, SESSION, auth(["CATALOG_PRODUCT_UPDATE"]), {
        presentationId,
        amount: "2000.000000",
        currencyCode: "COP",
        idempotencyKey: "price:denied",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(denied.kind).toBe("UNAUTHORIZED");

    const published = price.execute(
      SCOPE, SESSION, auth(["CATALOG_PRICE_PUBLISH"]), {
        presentationId,
        amount: "2000.000000",
        currencyCode: "COP",
        idempotencyKey: "price:ok",
        correlationId: CORRELATION,
        causationId: null,
      },
      NOW,
    );
    expect(published.kind).toBe("PUBLISHED");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true).quantity_on_hand)
      .toBe("5.000000");
  });
});

describe("catalog media validation and attach", () => {
  it("rejects invalid files and attaches a verified PNG reference", async () => {
    expect(validateCatalogMediaBytes(Buffer.from("not-an-image")).ok).toBe(false);
    const invalidType = validateCatalogMediaBytes(Buffer.alloc(10));
    expect(invalidType.ok).toBe(false);
    if (!invalidType.ok) expect(invalidType.reason).toBe("IMAGE_TYPE_INVALID");

    const tiny = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", (() => {
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(8, 0);
        ihdr.writeUInt32BE(8, 4);
        ihdr[8] = 8;
        ihdr[9] = 2;
        return ihdr;
      })()),
      chunk("IDAT", deflateSync(Buffer.alloc(8 * 3 + 1))),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const tinyResult = validateCatalogMediaBytes(tiny);
    expect(tinyResult.ok).toBe(false);
    if (!tinyResult.ok) expect(tinyResult.reason).toBe("IMAGE_DIMENSIONS_OUT_OF_RANGE");

    const { media, productId, catalogStore } = await buildEnv();
    const png = solidPng32();
    expect(validateCatalogMediaBytes(png)).toMatchObject({ ok: true, mime: "image/png" });

    const denied = media.put(
      SCOPE, auth(["CATALOG_PRODUCT_UPDATE"]), {
        productId,
        expectedVersion: 1,
        contentBase64: png.toString("base64"),
      },
      NOW,
    );
    expect(denied.kind).toBe("UNAUTHORIZED");

    const attached = media.put(
      SCOPE, auth(["CATALOG_MEDIA_MANAGE"]), {
        productId,
        expectedVersion: 1,
        contentBase64: png.toString("base64"),
      },
      NOW,
    );
    expect(attached.kind).toBe("ATTACHED");
    if (attached.kind !== "ATTACHED") return;
    expect(attached.mediaId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(catalogStore.findActiveProduct(SCOPE, productId)?.primaryMediaId).toBe(attached.mediaId);

    const loaded = media.get(SCOPE, auth(["CATALOG_PRODUCT_READ"]), attached.mediaId!, NOW);
    expect(loaded.kind).toBe("FOUND");
    if (loaded.kind !== "FOUND") return;
    expect(loaded.mimeType).toBe("image/png");
    expect(createHash("sha256").update(Buffer.from(loaded.contentBase64, "base64")).digest("hex"))
      .toBe(createHash("sha256").update(png).digest("hex"));

    const foreign = media.get(
      OTHER_SCOPE, auth(["CATALOG_PRODUCT_READ"], OTHER_COMPANY), attached.mediaId!, NOW,
    );
    expect(foreign.kind).toBe("NOT_FOUND");
  });

  it("refuses truncated PNG and leaves no ACTIVE media on version conflict", async () => {
    const truncated = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", (() => {
        const ihdr = Buffer.alloc(13);
        ihdr.writeUInt32BE(32, 0);
        ihdr.writeUInt32BE(32, 4);
        ihdr[8] = 8;
        ihdr[9] = 2;
        return ihdr;
      })()),
      // Missing IEND — not decodable/safe.
    ]);
    expect(validateCatalogMediaBytes(truncated).ok).toBe(false);

    const { media, productId, mediaStore, database, dir } = await buildEnv();
    const png = solidPng32([10, 20, 30]);
    const conflict = media.put(
      SCOPE, auth(["CATALOG_MEDIA_MANAGE"]), {
        productId,
        expectedVersion: 99,
        contentBase64: png.toString("base64"),
      },
      NOW,
    );
    expect(conflict).toMatchObject({ kind: "VERSION_CONFLICT", currentVersion: 1 });

    const activeCount = (database.native.prepare(
      `SELECT count(*) AS n FROM catalog_media WHERE status='ACTIVE'`,
    ).get() as { n: number }).n;
    expect(activeCount).toBe(0);
    expect(countFilesUnder(join(dir, "catalog-media"))).toBe(0);
    expect(countFilesUnder(join(dir, "catalog-media-staging"))).toBe(0);

    const reclaim = mediaStore.reclaimOrphans({
      tenantId: TENANT, companyId: COMPANY,
    });
    expect(reclaim.retired).toBe(0);
  });

  it("abandons staged bytes when confirm/attach cannot complete", async () => {
    const { mediaStore, catalogStore, productId, dir } = await buildEnv();
    const png = solidPng32([1, 2, 3]);
    const staged = mediaStore.stage({
      tenantId: TENANT, companyId: COMPANY, actorId: USER, bytes: png,
    });
    expect(staged.kind).toBe("STAGED");
    if (staged.kind !== "STAGED") return;
    expect(countFilesUnder(join(dir, "catalog-media-staging"))).toBe(1);

    // Simulate crash/reject between stage and confirm.
    mediaStore.abandonStaged(staged.staged);
    expect(countFilesUnder(join(dir, "catalog-media-staging"))).toBe(0);

    const confirmed = mediaStore.confirmStaged(staged.staged);
    expect(confirmed.kind).toBe("INVALID");

    // Confirm then failed attach → retire unattached ACTIVE row.
    const staged2 = mediaStore.stage({
      tenantId: TENANT, companyId: COMPANY, actorId: USER, bytes: png,
    });
    expect(staged2.kind).toBe("STAGED");
    if (staged2.kind !== "STAGED") return;
    const stored = mediaStore.confirmStaged(staged2.staged);
    expect(stored.kind).toBe("STORED");
    if (stored.kind !== "STORED") return;
    const attached = catalogStore.attachPrimaryMedia({
      scope: SCOPE,
      productId,
      expectedVersion: 99,
      mediaId: stored.media.id,
      operatorUserId: USER,
    });
    expect(attached.kind).toBe("VERSION_CONFLICT");
    mediaStore.retire(TENANT, COMPANY, stored.media.id);
    mediaStore.reclaimOrphans({ tenantId: TENANT, companyId: COMPANY, mediaId: stored.media.id });
    expect(catalogStore.findActiveProduct(SCOPE, productId)?.primaryMediaId).toBeNull();
  });
});

function countFilesUnder(root: string): number {
  if (!existsSync(root)) return 0;
  let count = 0;
  const walk = (path: string): void => {
    for (const name of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, name.name);
      if (name.isDirectory()) walk(next);
      else count += 1;
    }
  };
  walk(root);
  return count;
}

describe("transactional availability after reserve and sale deduction", () => {
  it("keeps physical/reserved/sellable consistent through reserve → consume → receive", async () => {
    const { inventoryStore, presentationId, receive } = await buildEnv();
    const admin = auth(["INVENTORY_STOCK_RECEIVE"]);
    expect(receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "20.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:20-tx",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");

    const saleId = randomUUID();
    const reserved = inventoryStore.createReservation({
      scope: SCOPE,
      sessionId: SESSION,
      actorId: USER,
      presentationId,
      quantity: "3.000000",
      referenceType: "SALE",
      referenceId: saleId,
      idempotencyKey: `inventory_reserve:sale:${saleId}:${presentationId}`,
      requestChecksum: "a".repeat(64),
      correlationId: CORRELATION,
      causationId: null,
      expiresAt: null,
    });
    expect(reserved.kind).toBe("RESERVED");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true)).toMatchObject({
      quantity_on_hand: "20.000000",
      quantity_reserved: "3.000000",
      quantity_available: "17.000000",
    });

    expect(inventoryStore.appendSaleDeduction({
      scope: SCOPE,
      sessionId: SESSION,
      operatorUserId: USER,
      saleId,
      presentationId,
      quantity: "3.000000",
      businessDate: "2026-09-07",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");
    expect(inventoryStore.appendSaleDeduction({
      scope: SCOPE,
      sessionId: SESSION,
      operatorUserId: USER,
      saleId,
      presentationId,
      quantity: "3.000000",
      businessDate: "2026-09-07",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("IDEMPOTENT");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true)).toMatchObject({
      quantity_on_hand: "17.000000",
      quantity_reserved: "0.000000",
      quantity_available: "17.000000",
    });

    expect(receive.execute(SCOPE, SESSION, admin, {
      presentationId,
      movementType: "PURCHASE_RECEIPT",
      quantity: "10.000000",
      reasonCode: "SUPPLIER_DELIVERY",
      businessDate: "2026-09-07",
      idempotencyKey: "recv:10-tx",
      correlationId: CORRELATION,
      causationId: null,
    }).kind).toBe("POSTED");
    expect(readCatalogAvailability(inventoryStore, SCOPE, presentationId, true)).toMatchObject({
      quantity_on_hand: "27.000000",
      quantity_available: "27.000000",
      quantity_reserved: "0.000000",
    });
  });
});
