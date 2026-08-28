import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLicenseCoverage, registryVersionUrl } from "./run-license-compatibility-gate.mjs";

const policy={schema:"pos-platform-license-compatibility-policy/v1",allow:{MIT:["preserve-license-text"],"Apache-2.0":["preserve-license-text"]},review:["NOASSERTION","NONE"],deny:["AGPL-3.0-only","AGPL-3.0-or-later","BUSL-1.1","GPL-2.0-only","GPL-2.0-or-later","GPL-3.0-only","GPL-3.0-or-later","SSPL-1.0","UNLICENSED"],allowWith:{}};
const fp=(name,version,manifest)=>({type:"library","bom-ref":`pkg:npm/${name}@${version}`,name,version,purl:`pkg:npm/${name}@${version}`,properties:[{name:"pos-platform:first-party",value:"true"},{name:"pos-platform:manifest",value:manifest}]});
const tp=(name,version)=>({type:"library","bom-ref":`pkg:npm/${name}@${version}`,name,version,purl:`pkg:npm/${name}@${version}`,properties:[{name:"pos-platform:first-party",value:"false"}]});

test("registry URL is pinned and encodes scoped identity",()=>assert.equal(registryVersionUrl("@scope/pkg","1.2.3"),"https://registry.npmjs.org/%40scope%2Fpkg/1.2.3"));
test("covers inventory and resolves SBOM-only optional components",async()=>{
  const bom={metadata:{component:fp("root","1.0.0","package.json")},components:[fp("@pos/workspace","1.0.0","packages/workspace/package.json"),tp("installed","1.0.0"),tp("@optional/platform","2.0.0")]};
  const inventory={packages:[{name:"installed",version:"1.0.0",license:"MIT"}]};
  const calls=[];
  const r=await evaluateLicenseCoverage({bom,inventory,policy,fetchLicense:async(name,version)=>{calls.push(`${name}@${version}`);return{license:"Apache-2.0",url:"https://registry.npmjs.org/mock"};}});
  assert.equal(r.thirdPartyCount,2); assert.equal(r.inventoryCoveredCount,1); assert.equal(r.registryResolvedCount,1); assert.deepEqual(calls,["@optional/platform@2.0.0"]); assert.deepEqual(r.counts,{ALLOW:2,REVIEW_REQUIRED:0,DENY:0});
});
test("inventory package absent from SBOM fails closed",async()=>{
  const bom={metadata:{component:fp("root","1.0.0","package.json")},components:[tp("present","1.0.0")]};
  await assert.rejects(()=>evaluateLicenseCoverage({bom,inventory:{packages:[{name:"missing",version:"1.0.0",license:"MIT"}]},policy,fetchLicense:async()=>({license:"MIT"})}),/missing from SBOM/);
});
test("missing registry metadata becomes REVIEW_REQUIRED",async()=>{
  const bom={metadata:{component:fp("root","1.0.0","package.json")},components:[tp("optional","1.0.0")]};
  const r=await evaluateLicenseCoverage({bom,inventory:{packages:[]},policy,fetchLicense:async()=>{throw new Error("registry unavailable");}});
  assert.deepEqual(r.counts,{ALLOW:0,REVIEW_REQUIRED:1,DENY:0});
});
test("registry-resolved GPL stays DENY",async()=>{
  const bom={metadata:{component:fp("root","1.0.0","package.json")},components:[tp("copyleft","1.0.0")]};
  const r=await evaluateLicenseCoverage({bom,inventory:{packages:[]},policy,fetchLicense:async()=>({license:"GPL-3.0-only"})});
  assert.equal(r.records[0].decision,"DENY");
});
