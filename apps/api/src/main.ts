import { createApi } from "./app.js";

/**
 * Sólo loopback, y no es configurable. TLS lo termina un proxy inverso delante
 * del proceso (`DEC-024`, hoy `PROPOSED`): este servidor recibirá contraseñas y
 * no debe poder exponerse por HTTP plano por un error de configuración.
 */
const HOST = "127.0.0.1";

function port(): number {
  const value = Number(process.env.API_PORT ?? "8080");
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error("API_PORT must be an integer between 1 and 65535");
  return value;
}

const app = await createApi();
await app.listen(port(), HOST);
