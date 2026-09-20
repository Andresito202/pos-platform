#!/usr/bin/env node
import { runDepositCli } from "./deposit-fiscal-credential.js";

/**
 * Entrada ejecutable del deposito de credencial fiscal.
 *
 * Uso previsto, desde la maquina donde corre el servicio:
 *
 * ```text
 * <gestor-de-secretos> | pnpm --filter @pos-platform/pos-local-service deposit-credential
 * ```
 *
 * El cuerpo es un JSON con `provider`, `environment` y `fields`. Nunca se pasa
 * por argumento ni por variable de entorno: ver el encabezado de
 * `deposit-fiscal-credential.ts`.
 *
 * Este fichero no hace nada mas que cablear: toda la logica —y toda su prueba—
 * vive en `runDepositCli`, que recibe el entorno, el flujo y el escritor.
 */
process.exitCode = await runDepositCli(
  process.env,
  process.stdin,
  (line) => { process.stdout.write(`${line}\n`); },
);
