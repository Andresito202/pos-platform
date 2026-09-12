/**
 * Produce el artefacto distribuible de `LOCAL_SERVICE`.
 *
 * `ReleaseArtifactSchema` (`packages/contracts/src/release.ts`, RT-009-A) exige
 * para cada componente **un fichero** con su `sha256` y su `size_bytes`. Un
 * `dist/` con `node_modules` al lado no satisface ese contrato: por eso la
 * salida es un único `.tar.gz`, y no una carpeta.
 *
 * Dentro viajan dos cosas, y sólo dos:
 *
 * 1. `pos-local-service.mjs` — todo el servicio y sus paquetes de workspace
 *    resueltos por esbuild. Fuera del monorepo los `workspace:*` no resuelven
 *    —exportan TypeScript crudo—, así que el bundle es la única forma de que el
 *    artefacto no dependa del repositorio fuente.
 * 2. `node_modules/better-sqlite3/` — **no se puede bundlear**: es un addon
 *    nativo. Se conserva su disposición original para que
 *    `require("better-sqlite3")` resuelva sin tocar una línea del servicio.
 *
 * `better-sqlite3@13` usa **Node-API**: `lib/binding.js` elige el prebuild por
 * `${platform}-${arch}` y **no consulta `process.versions.modules`**. Por eso no
 * hay ABI que fijar y el `win32-x64.node` que el paquete ya trae sirve tal cual.
 *
 * El `.tar.gz` es **reproducible**: mtime fijo, propietario neutro, orden
 * estable y gzip sin marca de tiempo. Dos ejecuciones sobre el mismo código dan
 * el mismo SHA-256, que es lo que el manifiesto de release necesita para
 * significar algo.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * La salida va a `dist/`, y no a `build/`, por una razón concreta: el validador
 * de fronteras recorre el proyecto y **omite `node_modules`, `.nx` y `dist`**
 * (`tools/architecture/validate-boundaries.mjs`). Con la salida en `build/`
 * leería el bundle generado como si fuera código fuente y reportaría que el
 * servicio importa `better-sqlite3` sin declararlo — un falso positivo del
 * artefacto, no del código.
 */
const outputDirectory = join(here, "dist");
const staging = join(outputDirectory, "staging");

/**
 * Plataforma objetivo. La release es `win32-x64` —`main.ts` rehúsa arrancar en
 * cualquier otra—, y es el valor por defecto.
 *
 * Se deja parametrizable por una razón concreta, no por generalidad: permite
 * construir el mismo bundle para la plataforma anfitriona y **ejecutarlo**, que
 * es la única manera de demostrar en Linux que el empaquetado resuelve sus
 * dependencias y carga el addon nativo. Esa construcción es de verificación, no
 * de distribución.
 */
const [TARGET_PLATFORM, TARGET_ARCH] = (process.env["POS_ARTIFACT_TARGET"] ?? "win32-x64").split("-");
const NODE_TARGET = "node22";

/** Época fija para que el archivo no dependa de cuándo se construyó. */
const FIXED_MTIME_SECONDS = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);

/**
 * `better-sqlite3` **no** es dependencia directa de este proyecto: lo declara
 * `@pos-platform/database-sqlite`, y con el `node_modules` estricto de pnpm no
 * es visible desde aquí. Se resuelve desde su declarante real, que es además la
 * única forma de garantizar que el artefacto lleva **la misma versión** que el
 * servicio ejecuta.
 */
/** Campo octal de cabecera USTAR, terminado en NUL. */
function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/**
 * Escritor `tar` determinista, en Node puro.
 *
 * No se delega en el `tar` del sistema a propósito: sus opciones de
 * normalización —`--sort`, `--owner`, `--mtime`, `--format`— difieren entre GNU
 * tar y el bsdtar que trae Windows, de modo que el artefacto dependería de en
 * qué máquina se construyó. Aquí cada campo se escribe explícitamente, así que
 * el mismo código produce los mismos bytes en cualquier plataforma.
 */
function buildTar(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    )) {
      const absolute = join(directory, entry.name);
      const name = relative(root, absolute).split(sep).join(posix.sep);
      if (entry.isDirectory()) {
        entries.push({ name: `${name}/`, type: "5", body: Buffer.alloc(0) });
        walk(absolute);
      } else {
        entries.push({ name, type: "0", body: readFileSync(absolute) });
      }
    }
  };
  walk(root);

  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write(octal(entry.type === "5" ? 0o755 : 0o644, 8), 100);
    header.write(octal(0, 8), 108);            // uid
    header.write(octal(0, 8), 116);            // gid
    header.write(octal(entry.body.length, 12), 124);
    header.write(octal(FIXED_MTIME_SECONDS, 12), 136);
    header.write("        ", 148);             // checksum en blanco para calcularlo
    header.write(entry.type, 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, entry.body);
    const padding = (512 - (entry.body.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));             // fin de archivo
  return Buffer.concat(blocks);
}

function resolveBetterSqlite3() {
  // Se entra por el enlace que pnpm deja en `node_modules`, no por `exports`:
  // el paquete de workspace sólo expone `.`, así que su `package.json` no es
  // resoluble como subruta.
  const declarant = join(here, "node_modules", "@pos-platform", "database-sqlite");
  const requireFromDeclarant = createRequire(join(declarant, "package.json"));
  return dirname(requireFromDeclarant.resolve("better-sqlite3/package.json"));
}

async function main() {
  // Sólo se limpia el `staging`, no todo `dist/`: la prueba construye la
  // variante de la plataforma anfitriona para poder ejecutarla, y borrar el
  // directorio entero destruiría el artefacto de release recién construido.
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const version = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).version;

  // 1. El servicio, con sus paquetes de workspace dentro.
  await build({
    entryPoints: [join(here, "src", "main.ts")],
    outfile: join(staging, "pos-local-service.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: NODE_TARGET,
    // El addon nativo no se bundlea: viaja entero y se resuelve por node_modules.
    external: ["better-sqlite3"],
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
  });

  // 2. El addon nativo, con su disposición intacta y **sólo** el prebuild de la
  //    plataforma objetivo: llevar los ocho multiplicaría el artefacto por seis
  //    con binarios que esta release nunca ejecutará.
  const source = resolveBetterSqlite3();
  const destination = join(staging, "node_modules", "better-sqlite3");
  mkdirSync(join(destination, "prebuilds"), { recursive: true });
  cpSync(join(source, "lib"), join(destination, "lib"), { recursive: true });
  cpSync(join(source, "package.json"), join(destination, "package.json"));
  const prebuild = `${TARGET_PLATFORM}-${TARGET_ARCH}.node`;
  cpSync(join(source, "prebuilds", prebuild), join(destination, "prebuilds", prebuild));

  // 3. Un solo fichero, reproducible.
  const name = `pos-local-service-${version}-${TARGET_PLATFORM}-${TARGET_ARCH}.tar.gz`;
  const artifact = join(outputDirectory, name);
  writeFileSync(artifact, gzipSync(buildTar(staging), { level: 9 }));

  const bytes = readFileSync(artifact);
  const report = {
    component: "LOCAL_SERVICE",
    version,
    filename: name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size_bytes: statSync(artifact).size,
    target: `${TARGET_PLATFORM}-${TARGET_ARCH}`,
    node_target: NODE_TARGET,
  };
  // El informe lleva el objetivo en el nombre: release y verificación conviven
  // sin que una sobrescriba el hash de la otra.
  writeFileSync(
    join(outputDirectory, `local-service-artifact-${TARGET_PLATFORM}-${TARGET_ARCH}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
