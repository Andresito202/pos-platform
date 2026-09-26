import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createApi } from "../src/app.js";

/**
 * La API central arranca con NestJS sobre Fastify (`ADR-005`, `DEC-026` G-7)
 * y atiende peticiones reales por el adaptador, sin abrir puerto.
 *
 * Necesita configuración válida para construir `AuthModule` —incluida una
 * URL de PostgreSQL—, pero **no la usa**: `pg.Pool` no conecta hasta la
 * primera consulta, y ninguna prueba de este archivo llama a `/v1/auth/*`.
 * Esa ruta real, contra PostgreSQL real, está en `device-login.postgres.test.ts`.
 */
describe("API central — arranque NestJS + Fastify", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.CENTRAL_DATABASE_URL ??= "postgres://postgres@127.0.0.1:1/nonexistent";
    process.env.DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM ??=
      generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.DEVICE_TRUST_OPERATIONAL_KEY_ID ??= "DEVICE-TRUST-BOOTSTRAP-TEST";
    process.env.DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM ??=
      generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
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
