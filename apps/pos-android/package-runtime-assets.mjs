import { createHash } from "node:crypto";
import { cpSync,existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
const project=dirname(fileURLToPath(import.meta.url)),root=join(project,"build/runtime-root"),assets=join(project,"build/runtime-assets/runtime");
mkdirSync(assets,{recursive:true});
for(const path of ["bin","lib","node_modules","share","runtime-probe.mjs"]) {
  if(!existsSync(join(root,path)))throw new Error("COMPILED_RUNTIME_REQUIRED: "+path);
  cpSync(join(root,path),join(assets,path),{recursive:true,dereference:true});
}
const provenance=readFileSync(join(project,"build/runtime-inputs/input-provenance.json"));
writeFileSync(join(assets,"input-provenance.json"),provenance);
const files={};
function walk(base,relative="") {
  for(const name of readdirSync(base).sort()){
    const path=join(base,name),key=relative?relative+"/"+name:name;
    if(key==="files.json")continue;
    if(statSync(path).isDirectory())walk(path,key);
    else files[key]=createHash("sha256").update(readFileSync(path)).digest("hex");
  }
}
walk(assets);
const bundle_id=createHash("sha256").update(JSON.stringify(files)).digest("hex");
writeFileSync(join(assets,"files.json"),JSON.stringify({bundle_id,files},null,2));
console.log(JSON.stringify({bundle_id,files:Object.keys(files).length,mode:"ISOLATED_ENGINE_PROBE_NO_COMMERCIAL_ACCESS"}));
