import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizedLicense } from "./generate-dependency-inventory.mjs";
import { evaluateSpdxLicenseExpression, validateLicensePolicy } from "./validate-spdx-license.mjs";

export const LICENSE_REGISTRY = "https://registry.npmjs.org/";
function sha256(value){ return createHash("sha256").update(value).digest("hex"); }
function isFirstParty(component){ return component?.properties?.some((p)=>p.name==="pos-platform:first-party"&&p.value==="true")===true; }
function sbomSourceCommit(bom){ return bom?.metadata?.properties?.find((p)=>p.name==="pos-platform:source-commit")?.value ?? null; }

export function registryVersionUrl(name,version) {
  if (typeof name!=="string"||!name||typeof version!=="string"||!version) throw new TypeError("registryVersionUrl requires package name and version");
  return `${LICENSE_REGISTRY}${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}
export async function fetchRegistryLicense(name,version,fetchImpl=fetch) {
  const url=registryVersionUrl(name,version);
  const response=await fetchImpl(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`registry metadata HTTP ${response.status} for ${name}@${version}`);
  const metadata=await response.json();
  if (metadata?.name!==name||metadata?.version!==version) throw new Error(`registry metadata identity mismatch for ${name}@${version}`);
  const license=normalizedLicense(metadata);
  if (!license) throw new Error(`registry metadata missing license for ${name}@${version}`);
  return {license,url};
}
async function mapWithConcurrency(items,limit,mapper) {
  const output=new Array(items.length); let cursor=0;
  async function worker(){ while(true){ const index=cursor++; if(index>=items.length)return; output[index]=await mapper(items[index],index); } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return output;
}
export async function evaluateLicenseCoverage({bom,inventory,policy,fetchLicense=fetchRegistryLicense}) {
  validateLicensePolicy(policy);
  const all=[bom?.metadata?.component,...(bom?.components??[])].filter(Boolean);
  const thirdParty=all.filter((c)=>!isFirstParty(c));
  if (!thirdParty.length) throw new Error("license gate requires non-empty third-party SBOM coverage");
  const sbomIdentity=new Map();
  for (const c of thirdParty) {
    if (!c.name||!c.version||!c["bom-ref"]) throw new Error("third-party SBOM component is missing identity fields");
    const key=`${c.name}@${c.version}`;
    if (sbomIdentity.has(key)) throw new Error(`duplicate third-party SBOM identity: ${key}`);
    sbomIdentity.set(key,c);
  }
  const inventoryByIdentity=new Map();
  for (const item of inventory?.packages??[]) {
    const key=`${item.name}@${item.version}`;
    if (inventoryByIdentity.has(key)) throw new Error(`duplicate dependency inventory identity: ${key}`);
    inventoryByIdentity.set(key,item);
    if (!sbomIdentity.has(key)) throw new Error(`dependency inventory package missing from SBOM: ${key}`);
  }
  const records=await mapWithConcurrency(thirdParty,8,async(c)=>{
    const key=`${c.name}@${c.version}`;
    const installed=inventoryByIdentity.get(key);
    let licenseExpression=installed?.license??null;
    let source="dependency-inventory", sourceUri=null, sourceError=null;
    if (!licenseExpression) {
      source="npm-registry";
      try { const resolved=await fetchLicense(c.name,c.version); licenseExpression=resolved.license; sourceUri=resolved.url??null; }
      catch(error){ sourceError=error instanceof Error?error.message:String(error); }
    }
    const evaluation=licenseExpression
      ? evaluateSpdxLicenseExpression(licenseExpression,policy)
      : {decision:"REVIEW_REQUIRED",selected:[],obligations:[],reasons:[`MISSING_LICENSE_METADATA:${sourceError??key}`]};
    return {bomRef:c["bom-ref"],name:c.name,version:c.version,licenseExpression,source,sourceUri,decision:evaluation.decision,selected:evaluation.selected,obligations:evaluation.obligations,reasons:evaluation.reasons};
  });
  records.sort((a,b)=>a.bomRef.localeCompare(b.bomRef));
  const counts={ALLOW:0,REVIEW_REQUIRED:0,DENY:0}; for(const r of records) counts[r.decision]+=1;
  return {records,counts,thirdPartyCount:thirdParty.length,inventoryCoveredCount:inventoryByIdentity.size,registryResolvedCount:records.filter((r)=>r.source==="npm-registry"&&r.licenseExpression).length};
}

export async function runLicenseCompatibilityGate(root=process.cwd()) {
  const out=path.join(root,"artifacts","ci"); mkdirSync(out,{recursive:true});
  const bomPath=path.join(out,"bom.cdx.json"), inventoryPath=path.join(out,"dependency-inventory.json");
  const policyPath=path.join(root,"tools","ci","license-compatibility-policy.json");
  const reportPath=path.join(out,"license-compatibility-report.json"), digestPath=path.join(out,"license-compatibility-report.json.sha256");
  const sourceCommit=process.env.REVIEWED_SHA??process.env.GITHUB_SHA??null;
  const base={schema:"pos-platform-license-compatibility-report/v1",sourceCommit,generatedAt:new Date().toISOString(),registry:LICENSE_REGISTRY};
  try {
    if (!/^[0-9a-f]{40}$/.test(sourceCommit??"")) throw new Error("license gate requires an exact 40-character reviewed SHA");
    const bomBytes=readFileSync(bomPath), inventoryBytes=readFileSync(inventoryPath), policyBytes=readFileSync(policyPath);
    const bom=JSON.parse(bomBytes), inventory=JSON.parse(inventoryBytes), policy=JSON.parse(policyBytes);
    if (sbomSourceCommit(bom)!==sourceCommit) throw new Error("SBOM source commit does not match the reviewed SHA");
    if (inventory.sourceCommit!==sourceCommit) throw new Error("dependency inventory source commit does not match the reviewed SHA");
    const coverage=await evaluateLicenseCoverage({bom,inventory,policy});
    const report={...base,status:coverage.counts.DENY===0&&coverage.counts.REVIEW_REQUIRED===0?"PASS":"FAIL",
      sbomSha256:sha256(bomBytes),inventorySha256:sha256(inventoryBytes),policySha256:sha256(policyBytes),
      thirdPartyCount:coverage.thirdPartyCount,inventoryCoveredCount:coverage.inventoryCoveredCount,registryResolvedCount:coverage.registryResolvedCount,
      decisionCounts:coverage.counts,components:coverage.records};
    const serialized=`${JSON.stringify(report,null,2)}\n`, digest=sha256(serialized);
    writeFileSync(reportPath,serialized,"utf8"); writeFileSync(digestPath,`${digest}  license-compatibility-report.json\n`,"utf8");
    if (report.status!=="PASS") {
      for(const c of report.components.filter((x)=>x.decision!=="ALLOW")) console.error(`::error::License gate ${c.decision} package=${c.name}@${c.version} expression=${c.licenseExpression??"MISSING"} reasons=${c.reasons.join("|")}`);
      process.exitCode=1; return report;
    }
    console.log(`License compatibility gate PASS: ${report.thirdPartyCount} third-party components, ${report.inventoryCoveredCount} from installed inventory, ${report.registryResolvedCount} resolved from exact npm registry versions, 0 review-required, 0 deny, sha256=${digest}.`);
    return report;
  } catch(error) {
    const report={...base,status:"FAIL",reason:error instanceof Error?error.message:String(error)};
    const serialized=`${JSON.stringify(report,null,2)}\n`;
    writeFileSync(reportPath,serialized,"utf8"); writeFileSync(digestPath,`${sha256(serialized)}  license-compatibility-report.json\n`,"utf8");
    console.error(`::error::License compatibility gate failed: ${report.reason}`); process.exitCode=1; return report;
  }
}
if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await runLicenseCompatibilityGate();
