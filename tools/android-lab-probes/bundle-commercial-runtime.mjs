import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { androidOperationalBoundary, assertAndroidOperationalInput } from "./operational-boundary.mjs";

const project = dirname(fileURLToPath(import.meta.url));
const { build } = createRequire(join(project, "../../apps/pos-local-service/package.json"))("esbuild");
const output = join(project, "build/runtime-root");
const result = await build({
  entryPoints: [join(project, "commercial-runtime-service.mts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["better-sqlite3"],
  outfile: join(output, "runtime-service.mjs"),
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  plugins: [androidOperationalBoundary()],
  metafile: true,
});
const included = Object.entries(result.metafile.outputs).flatMap(([, v]) =>
  Object.entries(v.inputs).filter(([, i]) => i.bytesInOutput > 0).map(([name]) => name),
);
included.forEach(assertAndroidOperationalInput);
const report = JSON.parse(readFileSync(join(output, "android-operational-boundary.json"), "utf8"));
report.entries["runtime-service"] = [...new Set(included)].sort();
report.sha256["runtime-service"] = createHash("sha256")
  .update(readFileSync(join(output, "runtime-service.mjs")))
  .digest("hex");
writeFileSync(join(output, "android-operational-boundary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  bundled: "commercial-runtime-service",
  sha256: report.sha256["runtime-service"],
  inputs: report.entries["runtime-service"].length,
}));
