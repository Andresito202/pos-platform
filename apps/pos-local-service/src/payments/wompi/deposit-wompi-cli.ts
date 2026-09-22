#!/usr/bin/env node
import { runWompiDepositCli } from "./deposit-wompi-credential.js";

/**
 * Entrada ejecutable del deposito de credencial de Wompi.
 *
 * Uso previsto, desde la maquina donde corre el servicio:
 *
 * ```text
 * <gestor-de-secretos> | pnpm --filter @pos-platform/pos-local-service deposit-wompi
 * ```
 *
 * El cuerpo es un JSON con `publicKey`, `integritySecret`, `eventsSecret` y
 * opcionalmente `redirectUrl`. Nunca se pasa por argumento ni por variable de
 * entorno: ver el encabezado de `deposit-wompi-credential.ts`.
 *
 * Este fichero no hace nada mas que cablear: toda la logica —y toda su
 * prueba— vive en `runWompiDepositCli`.
 */
process.exitCode = await runWompiDepositCli(
  process.env,
  process.stdin,
  (line) => { process.stdout.write(`${line}\n`); },
);
