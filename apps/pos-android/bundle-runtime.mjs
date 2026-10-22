import { createRequire } from "node:module";
import { dirname,join,resolve } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
const project=dirname(fileURLToPath(import.meta.url));
export async function bundleRuntime(output=join(project,"build/runtime-root")) {
  const {build}=createRequire(join(project,"../pos-local-service/package.json"))("esbuild");
  for(const entry of ["runtime-probe","runtime-service"])await build({
    entryPoints:[join(project,entry+".mts")],bundle:true,platform:"node",target:"node22",format:"esm",external:["better-sqlite3"],
    outfile:join(output,entry+".mjs"),banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"},
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await bundleRuntime();
