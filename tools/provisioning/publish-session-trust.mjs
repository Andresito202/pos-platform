#!/usr/bin/env node
/**
 * Publica el bundle de confianza de sesión — `G1.2`, con una clave por
 * propósito (`D-31`).
 *
 * **Corre en la máquina del propietario, nunca en CI ni en el servicio.** La
 * clave raíz se pasa como ruta y no se copia, no se imprime y no entra al
 * repositorio.
 *
 * ## Por qué genera las claves además de publicarlas
 *
 * Porque separarlo crea la única forma de equivocarse que no avisa: publicar
 * la clave pública de un par y firmar con la privada de otro. El equipo
 * respondería `SIGNATURE_INVALID` a toda sesión sin decir por qué, y el fallo
 * aparecería en un mostrador. Generando y publicando en el mismo acto, el par
 * no puede desemparejarse.
 *
 * Uso:
 *   node tools/provisioning/publish-session-trust.mjs \
 *     --root-key <ruta-clave-raiz-privada-pem> \
 *     --session-key-id SSA-2026-01 --snapshot-key-id SAS-2026-01 \
 *     --environment PRODUCTION --out-dir <carpeta-segura>
 *
 * Escribe tres ficheros en `--out-dir`:
 *   session-trust.json                  → el bundle. Va al equipo.
 *   session-assertion-private.pem       → se queda contigo. Firma la SSA.
 *   authorization-snapshot-private.pem  → se queda contigo. Firma el SAS.
 *
 * **Sólo el primero viaja al equipo.** Los otros dos son para
 * `sign-operator-session.mjs`.
 */
import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    if (fallback !== undefined) return fallback;
    throw new Error(`falta --${name}`);
  }
  return process.argv[index + 1];
}

/**
 * Serialización canónica, idéntica a `canonicalSessionTrustJson` del contrato.
 *
 * Se reimplementa aquí —y sólo aquí— porque esta herramienta corre fuera del
 * workspace compilado, con `node` a secas. Si las dos divergieran, la firma no
 * verificaría: hay una prueba que ejecuta ESTA herramienta y verifica su
 * resultado con el verificador del SERVICIO, para que esa divergencia falle en
 * CI y no en un mostrador.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/**
 * El alfabeto de `StableCodeSchema`, copiado del contrato.
 *
 * Se comprueba aquí, donde se puede corregir escribiendo otra cosa. Es
 * exactamente lo que le falta al artefacto publicado en su día (`D-30`):
 * `ssa-2026-01` y `production` en minúsculas no parsean, y el equipo lo
 * descubre rechazando toda sesión.
 */
const STABLE_CODE = /^[A-Z][A-Z0-9_]*(?:[.:-][A-Z0-9_]+)*$/;

function assertStableCode(name, value) {
  if (!STABLE_CODE.test(value)) {
    throw new Error(
      `--${name} debe ser un codigo estable en MAYUSCULAS (${String(STABLE_CODE)}); recibido: ${value}`,
    );
  }
}

function main() {
  const rootKey = createPrivateKey(readFileSync(argument("root-key"), "utf8"));
  if (rootKey.asymmetricKeyType !== "ed25519") {
    throw new Error("la clave raiz tiene que ser Ed25519");
  }

  const environment = argument("environment");
  const sessionKeyId = argument("session-key-id");
  const snapshotKeyId = argument("snapshot-key-id");
  const outDir = argument("out-dir");
  const bundleVersion = Number(argument("bundle-version", "1"));
  const validFrom = argument("valid-from", new Date().toISOString());

  assertStableCode("environment", environment);
  assertStableCode("session-key-id", sessionKeyId);
  assertStableCode("snapshot-key-id", snapshotKeyId);
  if (sessionKeyId === snapshotKeyId) {
    throw new Error("--session-key-id y --snapshot-key-id tienen que ser distintos: el bundle exige key_id unico");
  }
  if (!Number.isSafeInteger(bundleVersion) || bundleVersion < 1) {
    throw new Error("--bundle-version tiene que ser un entero positivo");
  }

  // Una clave por proposito. Firmar identidad y firmar permisos son dominios
  // distintos: compartirlas anularia la separacion que el ancla mantiene.
  const publish = (keyId, purpose) => {
    const pair = generateKeyPairSync("ed25519");
    const claims = {
      key_id: keyId,
      key_purpose: purpose,
      environment,
      public_key_pem: pair.publicKey.export({ type: "spki", format: "pem" }),
      status: "ACTIVE",
      valid_from: validFrom,
      valid_until: null,
      version: 1,
    };
    return {
      privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      signed: {
        claims,
        signature: sign(null, Buffer.from(canonicalJson(claims)), rootKey).toString("base64url"),
      },
    };
  };

  const session = publish(sessionKeyId, "SESSION_ASSERTION");
  const snapshot = publish(snapshotKeyId, "AUTHORIZATION_SNAPSHOT");

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const bundlePath = join(outDir, "session-trust.json");
  writeFileSync(bundlePath, `${JSON.stringify({
    version: bundleVersion,
    keys: [session.signed, snapshot.signed],
  }, null, 2)}\n`, "utf8");

  // Las privadas, con permisos restrictivos. En Windows el modo es orientativo:
  // protege la CARPETA, que ahi es donde manda el control de acceso.
  const sessionKeyPath = join(outDir, "session-assertion-private.pem");
  const snapshotKeyPath = join(outDir, "authorization-snapshot-private.pem");
  writeFileSync(sessionKeyPath, session.privatePem, { encoding: "utf8", mode: 0o600 });
  writeFileSync(snapshotKeyPath, snapshot.privatePem, { encoding: "utf8", mode: 0o600 });

  // Nunca una clave, ni publica ni privada: solo que se escribio y donde.
  process.stdout.write(
    `bundle publicado    : ${bundlePath}\n`
    + `  ${sessionKeyId} (SESSION_ASSERTION)\n`
    + `  ${snapshotKeyId} (AUTHORIZATION_SNAPSHOT)\n`
    + `clave de sesion     : ${sessionKeyPath}\n`
    + `clave de permisos   : ${snapshotKeyPath}\n`
    + `\nSolo session-trust.json viaja al equipo. Las dos .pem se quedan contigo.\n`,
  );
}

main();
