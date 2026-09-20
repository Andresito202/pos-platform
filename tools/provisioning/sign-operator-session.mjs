#!/usr/bin/env node
/**
 * Firma un artefacto de aprovisionamiento de sesión de operador — `DEC-025` D4.
 *
 * **Corre en la máquina del propietario, nunca en CI ni en el servicio.** La
 * clave privada operacional se pasa como ruta de fichero y no se copia, no se
 * imprime y no entra al repositorio. `ci:repository-policy` ya rechaza material
 * privado rastreado, y esta herramienta no le pide una excepción.
 *
 * No es un emisor central: no escucha en ningún puerto y no autentica a nadie.
 * Exponerlo por red sería `SEC-G02`, que sigue fuera de alcance.
 *
 * Uso:
 *   node tools/provisioning/sign-operator-session.mjs \
 *     --key <ruta-clave-privada-pem> --key-id <id-en-el-ancla> \
 *     --input <ruta-json-de-entrada> --output <ruta-artefacto>
 *
 * El JSON de entrada lleva el binding del equipo, la identidad del operador y
 * sus asignaciones de rol. Se documenta con un ejemplo en
 * `tools/provisioning/README.md`.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    throw new Error(`falta --${name}`);
  }
  return process.argv[index + 1];
}

/**
 * Serialización canónica, idéntica a `channel/canonical-json.ts`.
 *
 * Se reimplementa aquí —y sólo aquí— porque esta herramienta corre fuera del
 * workspace compilado, con `node` a secas y sin dependencias. Si las dos
 * divergieran, la firma no verificaría: hay una prueba que las compara sobre
 * el mismo objeto para que esa divergencia falle en CI y no en un mostrador.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function signClaims(claims, privateKey) {
  return {
    claims,
    signature: sign(null, Buffer.from(canonicalJson(claims)), privateKey).toString("base64url"),
  };
}

/** El binding tiene que ser el mismo en los dos sobres: `DEC-025` D3.3. */
function assertSameBinding(session, snapshot) {
  for (const field of ["user_id", "installation_id", "device_id"]) {
    if (session[field] !== snapshot[field]) {
      throw new Error(`binding incoherente en ${field}: los dos sobres deben coincidir`);
    }
  }
}

function main() {
  const privateKey = createPrivateKey(readFileSync(argument("key"), "utf8"));
  const keyId = argument("key-id");
  const input = JSON.parse(readFileSync(argument("input"), "utf8"));

  const sessionClaims = { ...input.session_assertion, key_id: keyId };
  const snapshotClaims = { ...input.authorization_snapshot, key_id: keyId };
  assertSameBinding(sessionClaims, snapshotClaims);

  const artifact = {
    version: 1,
    session_assertion: signClaims(sessionClaims, privateKey),
    authorization_snapshot: signClaims(snapshotClaims, privateKey),
  };

  writeFileSync(argument("output"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  // Nunca la clave, nunca los claims: sólo que se escribió y para quién.
  process.stdout.write(
    `artefacto escrito para user_id=${sessionClaims.user_id} device_id=${sessionClaims.device_id}\n`,
  );
}

main();
