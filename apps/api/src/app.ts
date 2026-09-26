import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

/**
 * Tope de cuerpo de petición. El login es la petición más grande prevista
 * (identificador + contraseña de hasta 128 caracteres + código MFA), así que
 * 16 KiB sobra; el límite por defecto de Fastify (1 MiB) sería superficie gratis.
 */
const BODY_LIMIT_BYTES = 16 * 1024;

/**
 * Construye la aplicación sin ponerla a escuchar, para que las pruebas usen
 * exactamente la misma configuración que `main.ts`.
 *
 * Las dependencias se inyectan con `@Inject(TOKEN)` explícito: `tsx` y
 * `vitest` compilan con esbuild, que no emite `emitDecoratorMetadata`, y la
 * inyección por tipo de parámetro fallaría en silencio fuera de `tsc`.
 */
export async function createApi(): Promise<NestFastifyApplication> {
  return NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES }),
    { logger: ["error", "warn"] },
  );
}
