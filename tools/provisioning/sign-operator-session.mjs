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
 *     --session-key <ruta-pem> --session-key-id <id-en-el-ancla> \
 *     --snapshot-key <ruta-pem> --snapshot-key-id <id-en-el-ancla> \
 *     --input <ruta-json-de-entrada> --output <ruta-artefacto>
 *
 * **Dos claves, una por sobre** (`D-31`). Firmar identidad (`SESSION_ASSERTION`)
 * y firmar permisos (`AUTHORIZATION_SNAPSHOT`) son dominios criptograficos
 * distintos y el equipo los verifica contra anclas distintas. Antes se pasaba
 * una sola `--key` y se firmaban ambos sobres con ella: eso solo funcionaba
 * porque el ancla de permisos no se poblaba nunca y el segundo sobre no
 * llegaba a verificarse.
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
  const sessionKey = createPrivateKey(readFileSync(argument("session-key"), "utf8"));
  const snapshotKey = createPrivateKey(readFileSync(argument("snapshot-key"), "utf8"));
  const sessionKeyId = argument("session-key-id");
  const snapshotKeyId = argument("snapshot-key-id");
  const input = JSON.parse(readFileSync(argument("input"), "utf8"));

  // El bundle exige `key_id` unico en todo el artefacto, asi que dos sobres
  // con el mismo id no llegarian a instalarse. Se dice aqui, donde se puede
  // corregir, y no como un rechazo opaco en el mostrador.
  if (sessionKeyId === snapshotKeyId) {
    throw new Error("--session-key-id y --snapshot-key-id tienen que ser distintos: son claves de propositos distintos");
  }

  const sessionClaims = { ...input.session_assertion, key_id: sessionKeyId };
  const snapshotClaims = { ...input.authorization_snapshot, key_id: snapshotKeyId };
  assertSameBinding(sessionClaims, snapshotClaims);

  const artifact = {
    version: 1,
    session_assertion: signClaims(sessionClaims, sessionKey),
    authorization_snapshot: signClaims(snapshotClaims, snapshotKey),
  };

  writeFileSync(argument("output"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  // Nunca la clave, nunca los claims: sólo que se escribió y para quién.
  process.stdout.write(
    `artefacto escrito para user_id=${sessionClaims.user_id} device_id=${sessionClaims.device_id}\n`,
  );
}

main();
