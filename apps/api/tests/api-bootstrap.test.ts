import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApi } from "../src/app.js";

/**
 * La API central arranca con NestJS sobre Fastify (`ADR-005`, `DEC-026` G-7)
 * y atiende peticiones reales por el adaptador, sin abrir puerto.
 */
describe("API central — arranque NestJS + Fastify", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApi();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("corre sobre Fastify, no sobre Express", () => {
    expect(app.getHttpAdapter().getType()).toBe("fastify");
  });

  it("GET /v1/health responde UP sin describir el servidor", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "UP" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("una ruta que no existe es 404", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/v1/no-existe" });
    expect(response.statusCode).toBe(404);
  });

  it("rechaza un cuerpo por encima del tope de 16 KiB", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/v1/health",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ relleno: "x".repeat(17 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
  });
});
