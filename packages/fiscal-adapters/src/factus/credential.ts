import * as z from "zod";
import type { CredentialReference } from "../credential.js";

/**
 * Los cuatro valores que FACTUS entrega al cliente
 * (`provider-integration-matrix.md`, verificado 2026-08-17).
 *
 * Este tipo **no se serializa nunca**. No tiene `toJSON`, no se escribe en
 * logs, no viaja en errores y no se guarda. Existe sólo dentro del adapter,
 * entre resolver el secreto y firmar la petición.
 */
export interface FactusCredential {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly username: string;
  readonly password: string;
}

/**
 * Resolución del secreto custodiado.
 *
 * El núcleo entrega una `CredentialReference` opaca; quien implemente este
 * puerto en producción es el almacén de `SEC-004`. En CI lo implementa un fake
 * con valores inventados que nunca salen del proceso.
 */
export interface FactusCredentialResolver {
  resolve(reference: CredentialReference): Promise<FactusCredential>;
}

/**
 * Nombres de variable de entorno para la ejecución local contra el sandbox
 * real. **Los nombres son públicos; los valores no** — `fiscal-adapter-gate.md`
 * §12.2. Ninguno se lee en CI.
 */
export const FACTUS_SANDBOX_ENV = {
  clientId: "FACTUS_SANDBOX_CLIENT_ID",
  clientSecret: "FACTUS_SANDBOX_CLIENT_SECRET",
  username: "FACTUS_SANDBOX_USERNAME",
  password: "FACTUS_SANDBOX_PASSWORD",
} as const;

export const FactusTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
});

export type FactusTokenResponse = z.infer<typeof FactusTokenResponseSchema>;
