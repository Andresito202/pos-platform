import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { uuidV7 } from "../src/shared.js";
import { insertFiscalDraft, insertFiscalFoundation, scenario, seedFiscalIntegration } from "./fixtures/fiscal-test-model.js";

const url = process.env.POSTGRES_FISCAL_PACKAGE_TEST_URL;
describe.skipIf(!url)("PostgreSQL 039 document package ledger", () => {
  const pool = new Pool({ connectionString: url });
  const tenant = uuidV7();
  const company = uuidV7();
  const otherCompany = uuidV7();
  const branch = uuidV7();
  const fixture = { ...scenario(39), tenant, company, branch };
  const purchase = uuidV7();
  afterAll(() => pool.end());

  async function inRole<T>(role: "pos_app" | "pos_platform_app", holder: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(role === "pos_app" ? "SET LOCAL ROLE pos_app" : "SET LOCAL ROLE pos_platform_app");
      await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)", [tenant, holder]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const inCompany = <T>(holder: string, work: (client: PoolClient) => Promise<T>) => inRole("pos_platform_app", holder, work);

  const move = (client: PoolClient, document: string, request: string, action: "RESERVE" | "CONSUME" | "RELEASE") =>
    client.query<{ state: string }>("SELECT fiscal.apply_document_package_movement($1,$2,$3,$4) AS state", [purchase, document, request, action])
      .then((result) => result.rows[0]?.state);

  it("enforces scoped reservations, conservation, replay and durable thresholds", async () => {
    const offers = await pool.query("SELECT document_count, sale_price_cop, published FROM fiscal.document_package_offers ORDER BY document_count");
    expect(offers.rows.map((offer) => [offer.document_count, Number(offer.sale_price_cop), offer.published])).toEqual([
      [150, 169000, false], [400, 190000, false], [1600, 220000, false], [2500, 260000, false],
      [5000, 290000, false], [10000, 390000, false], [15000, 440000, false], [20000, 490000, false],
      [35000, 820000, false], [50000, 1100000, false], [80000, 1700000, false], [120000, 2160000, false],
    ]);
    await seedFiscalIntegration(fixture, url!);
    await insertFiscalFoundation(fixture, (_role, _tenant, work) => inRole("pos_app", company, work));
    await pool.query("UPDATE organization.companies SET tax_id='90001', tax_id_normalized='90001' WHERE id=$1", [company]);
    await pool.query(`INSERT INTO organization.companies(id,tenant_id,trade_name,tax_id,tax_id_normalized,timezone,currency_code,status,created_at,updated_at)
      VALUES($1,$2,'Other holder','90002','90002','America/Bogota','COP','ACTIVE',now(),now())`, [otherCompany, tenant]);
    await pool.query("UPDATE fiscal.document_package_offers SET published=true, validity_days=30, provider_cost_cop=140000 WHERE document_count=150");

    const createPurchase = (holder: string, tax: string) => inCompany(holder, (client) => client.query(
      `INSERT INTO fiscal.document_package_purchases(id,tenant_id,company_id,tax_id,payment_reference,acquired,provider_cost_cop,sale_price_cop,starts_at,expires_at)
       VALUES($1,$2,$3,$4,$5,150,140000,169000,now(),now()+interval '30 days')`,
      [purchase, tenant, holder, tax, uuidV7()]));
    await expect(createPurchase(company, "90002")).rejects.toThrow("FISCAL_PACKAGE_HOLDER_REJECTED");
    await createPurchase(company, "90001");

    const docs = Array.from({ length: 151 }, () => uuidV7());
    await inRole("pos_app", company, async (client) => {
      for (const [index, document] of docs.entries()) {
        await insertFiscalDraft(client, { ...fixture, n: 4000 + index, document, source: uuidV7(), preparation1: uuidV7() });
      }
    });

    const request = uuidV7();
    await expect(inCompany(otherCompany, (client) => move(client, docs[0]!, request, "RESERVE"))).rejects.toThrow("FISCAL_PACKAGE_NOT_AVAILABLE");
    await inCompany(company, async (client) => {
      expect(await move(client, docs[0]!, request, "RESERVE")).toBe("RESERVED");
      expect(await move(client, docs[0]!, request, "RESERVE")).toBe("RESERVED");
      for (const doc of docs.slice(1, 149)) await move(client, doc, uuidV7(), "RESERVE");
    });
    await expect(inCompany(company, (client) => move(client, docs[1]!, request, "RELEASE"))).rejects.toThrow("FISCAL_PACKAGE_IDEMPOTENCY_CONFLICT");
    await expect(inCompany(company, (client) => move(client, docs[0]!, uuidV7(), "CONSUME"))).rejects.toThrow("FISCAL_PACKAGE_DOCUMENT_EVIDENCE_REQUIRED");
    const concurrent = await Promise.allSettled(docs.slice(149).map((doc) => inCompany(company, (client) => move(client, doc, uuidV7(), "RESERVE"))));
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: "FISCAL_PACKAGE_QUOTA_UNAVAILABLE" }) });

    expect(await inCompany(company, (client) => move(client, docs[1]!, uuidV7(), "RELEASE"))).toBe("RELEASED");
    await pool.query("UPDATE organization.companies SET tax_id='90003', tax_id_normalized='90003' WHERE id=$1", [company]);
    await expect(inCompany(company, (client) => move(client, docs[1]!, uuidV7(), "RESERVE"))).rejects.toThrow("FISCAL_PACKAGE_HOLDER_REJECTED");
    await inCompany(company, async (client) => {
      expect((await client.query("SELECT assigned,reserved,consumed,available FROM fiscal.document_package_balances")).rows)
        .toEqual([{ assigned: 150, reserved: 149, consumed: 0, available: 1 }]);
      expect((await client.query("SELECT threshold_percent FROM fiscal.document_package_alerts ORDER BY threshold_percent")).rows)
        .toEqual([5, 10, 20].map((threshold_percent) => ({ threshold_percent })));
      expect((await client.query("SELECT count(*)::int AS movements FROM fiscal.document_package_movements")).rows[0])
        .toEqual({ movements: 151 });
    });
  }, 30_000);
});
