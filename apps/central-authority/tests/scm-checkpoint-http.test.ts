import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScmCheckpointHandler } from "../src/scm-checkpoint-http.js";
import type { VerifiedDeviceProofBinding } from "@pos-platform/database-postgres";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function fixture() {
  const binding: VerifiedDeviceProofBinding = { installationId: randomUUID(), deviceId: randomUUID(), tenantId: randomUUID(), companyId: randomUUID(), credentialId: randomUUID(), credentialExpiresAt: new Date(Date.now() + 3600000).toISOString(), requestId: randomUUID(), correlationId: randomUUID() };
  const proofs = { verifyCheckpointAndConsume: vi.fn(async () => binding as VerifiedDeviceProofBinding | null) };
  const repository = { latest: vi.fn(async () => null) };
  const handler = createScmCheckpointHandler(proofs, repository);
  const server = createServer((req, res) => { void handler(req, res); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("NO_ADDRESS");
  const headers = { authorization: "DeviceProof TEST_ONLY", "content-type": "application/json", "x-request-id": randomUUID(), "x-correlation-id": randomUUID() };
  const url = `http://127.0.0.1:${address.port}/v1/scm/checkpoint`;
  return { proofs, repository, headers, url, binding };
}
describe("SCM authenticated HTTP publication", () => {
  it("derives lookup scope exclusively from consumed device proof", async () => {
    const s = await fixture(); const response = await fetch(s.url, { method: "POST", headers: s.headers, body: "{}" });
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(s.repository.latest).toHaveBeenCalledWith(s.binding.installationId, s.binding.deviceId);
    expect(s.proofs.verifyCheckpointAndConsume).toHaveBeenCalledWith(expect.objectContaining({ body: "{}", authorization: s.headers.authorization, requestId: s.headers["x-request-id"] }));
  });
  it("rejects replay/invalid authentication without reading checkpoint state", async () => {
    const s = await fixture(); s.proofs.verifyCheckpointAndConsume.mockResolvedValue(null);
    expect((await fetch(s.url, { method: "POST", headers: s.headers, body: "{}" })).status).toBe(401);
    expect(s.repository.latest).not.toHaveBeenCalled();
  });
  it.each(["{\"device_id\":\"foreign\"}", " ".repeat(1025)])("rejects body scope substitution or size overflow", async body => {
    const s = await fixture(); expect((await fetch(s.url, { method: "POST", headers: s.headers, body })).status).toBe(body.length > 1024 ? 413 : 400);
    expect(s.proofs.verifyCheckpointAndConsume).not.toHaveBeenCalled(); expect(s.repository.latest).not.toHaveBeenCalled();
  });
  it("database failure returns no authority payload", async () => {
    const s = await fixture(); s.repository.latest.mockRejectedValue(Error("DATABASE_OFFLINE"));
    const response = await fetch(s.url, { method: "POST", headers: s.headers, body: "{}" });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "SCM_UNAVAILABLE" });
  });
  it("does not expose an unauthenticated GET endpoint", async () => {
    const s = await fixture(); expect((await fetch(s.url)).status).toBe(404); expect(s.repository.latest).not.toHaveBeenCalled();
  });
  it("limits per-device polling independently of a shared network address", async () => {
    const s = await fixture();
    for (let index = 0; index < 30; index++) expect((await fetch(s.url, { method: "POST", headers: s.headers, body: "{}" })).status).toBe(404);
    expect((await fetch(s.url, { method: "POST", headers: s.headers, body: "{}" })).status).toBe(429);
    expect(s.repository.latest).toHaveBeenCalledTimes(30);
  });
});
