import { createRequire } from "node:module";
import { dirname,join,resolve } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import {androidOperationalBoundary,assertAndroidOperationalInput} from "./operational-boundary.mjs";
import {writeFileSync,readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const project=dirname(fileURLToPath(import.meta.url));
export async function bundleRuntime(output=join(project,"build/runtime-root")) {
  const {build}=createRequire(join(project,"../pos-local-service/package.json"))("esbuild");
  const evidence={profile:"ANDROID_OPERATIONAL_ONLY",entries:{},sha256:{}};
  for(const entry of ["runtime-probe","runtime-service"]){const result=await build({
    entryPoints:[join(project,entry+".mts")],bundle:true,platform:"node",target:"node22",format:"esm",external:["better-sqlite3"],
    outfile:join(output,entry+".mjs"),banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"},
    plugins:[androidOperationalBoundary()],metafile:true,
  });
    const included=Object.entries(result.metafile.outputs).flatMap(([,v])=>Object.entries(v.inputs).filter(([,i])=>i.bytesInOutput>0).map(([name])=>name));
    included.forEach(assertAndroidOperationalInput);evidence.entries[entry]=[...new Set(included)].sort();
    evidence.sha256[entry]=createHash('sha256').update(readFileSync(join(output,entry+'.mjs'))).digest('hex');
  }
  writeFileSync(join(output,"android-operational-boundary.json"),JSON.stringify(evidence,null,2));
  return evidence;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await bundleRuntime();
