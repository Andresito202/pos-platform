import { createHash,createPublicKey,generateKeyPairSync,randomBytes,randomUUID,sign,verify } from "node:crypto";
import { existsSync,mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { resolve,join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

export const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
function check(ok,code){if(!ok)throw new Error(code);}
function objectFile(path){return JSON.parse(readFileSync(path,"utf8"));}
export function initialize(directory,trustHours,maxJobSeconds){
  check(Number.isInteger(trustHours)&&trustHours>=1&&trustHours<=168,"EXPLICIT_TRUST_HOURS_1_TO_168_REQUIRED");
  check(Number.isInteger(maxJobSeconds)&&maxJobSeconds>=1&&maxJobSeconds<=3600,"EXPLICIT_MAX_JOB_SECONDS_REQUIRED");
  const privateDir=join(directory,"private"),assets=join(directory,"assets");
  check(!existsSync(join(privateDir,"authority.pem")),"LAB_AUTHORITY_ALREADY_EXISTS_DO_NOT_OVERWRITE");
  mkdirSync(privateDir,{recursive:true,mode:0o700});mkdirSync(assets,{recursive:true});
  if(process.platform==="win32"){
    const account=execFileSync("whoami.exe",[],{encoding:"utf8",windowsHide:true}).trim();
    execFileSync("icacls.exe",[privateDir,"/inheritance:r","/grant:r",`${account}:(OI)(CI)F`],{windowsHide:true,stdio:"ignore"});
  }
  const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  writeFileSync(join(privateDir,"authority.pem"),pair.privateKey.export({format:"pem",type:"pkcs8"}),{mode:0o600});
  writeFileSync(join(privateDir,"apk.env"),`CAMACHO_LAB_APK_PASSWORD=${randomBytes(32).toString("hex")}\n`,{mode:0o600});
  const now=Date.now(),policy={version:"1.0.0",purpose:"HARDWARE_PHYSICAL_LAB",public_key_spki:pair.publicKey.export({format:"der",type:"spki"}).toString("base64"),not_before_ms:now,expires_at_ms:now+trustHours*3600000,max_job_seconds:maxJobSeconds};
  writeFileSync(join(assets,"lab-policy.json"),JSON.stringify(policy,null,2));return policy;
}
export function readVerifiedReport(envelope,expectedFingerprint){
  check(Object.keys(envelope).sort().join(",")==="body_base64,device_public_key_spki,signature_base64","REPORT_FIELDS_REJECTED");
  const spki=Buffer.from(envelope.device_public_key_spki,"base64");
  check(digest(spki)===expectedFingerprint,"PHYSICALLY_CHECKED_DEVICE_KEY_REQUIRED");
  const body=Buffer.from(envelope.body_base64,"base64");check(body.length<=128*1024,"REPORT_TOO_LARGE");
  check(verify("sha256",body,createPublicKey({key:spki,format:"der",type:"spki"}),Buffer.from(envelope.signature_base64,"base64")),"REPORT_SIGNATURE_REJECTED");
  const report=JSON.parse(body.toString("utf8"));
  check(report.purpose==="HARDWARE_PHYSICAL_LAB_REPORT"&&report.version==="1.0.0"&&report.key_fingerprint===expectedFingerprint,"REPORT_PURPOSE_REJECTED");
  check(report.sdk>=28&&Array.isArray(report.devices),"ANDROID_REPORT_REJECTED");return report;
}
export function issueJob({policy,privateKey,report,usbName,interfaceIndex,endpoint,profile,kind,reason,seconds,now=Date.now()}){
  check(policy.purpose==="HARDWARE_PHYSICAL_LAB"&&policy.version==="1.0.0"&&now>=policy.not_before_ms&&now<policy.expires_at_ms,"LAB_AUTHORITY_EXPIRED");
  check(Number.isInteger(seconds)&&seconds>0&&seconds<=policy.max_job_seconds,"EXPLICIT_JOB_DURATION_REQUIRED");
  check(kind==="PRINT_TEST"||kind==="DRAWER_OPEN","LAB_KIND_REJECTED");
  check(typeof reason==="string"&&reason.trim().length>=3&&reason.length<=200,"REASON_REQUIRED");
  const publicDer=createPublicKey(privateKey).export({format:"der",type:"spki"});
  check(publicDer.equals(Buffer.from(policy.public_key_spki,"base64")),"LAB_SIGNER_MISMATCH");
  check(report.app_authority_sha256===digest(publicDer),"APK_AUTHORITY_MISMATCH");
  check(report.observed_at_ms<=now&&now-report.observed_at_ms<=policy.max_job_seconds*1000,"FRESH_DEVICE_REPORT_REQUIRED");
  const usb=report.devices.find(d=>d.usb_name===usbName);check(usb?.permission===true&&/^[a-f0-9]{64}$/.test(usb.descriptor_sha256),"USB_PERMISSION_AND_DESCRIPTOR_REQUIRED");
  check(usb.endpoints.some(e=>e.interface_index===interfaceIndex&&e.address===endpoint&&e.bulk_out===true),"EXACT_USB_BULK_OUT_REQUIRED");
  check(profile.printer_model==="GP-L80160"&&profile.protocol==="ESC_POS","REVIEWED_PRINTER_MODEL_REQUIRED");
  for(const key of ["printer_firmware","identity_evidence","command_evidence"])check(typeof profile[key]==="string"&&profile[key].trim().length>=3&&!/unknown|pending|por verificar|por confirmar/i.test(profile[key]),"VERIFIED_PROFILE_EVIDENCE_REQUIRED");
  check(Number.isInteger(profile.timeout_ms)&&profile.timeout_ms>=100&&profile.timeout_ms<=30000,"EXPLICIT_USB_TIMEOUT_REQUIRED");
  if(kind==="PRINT_TEST")check(profile.drawer===null,"PRINT_MUST_NOT_INCLUDE_DRAWER");
  else {
    const d=profile.drawer;check(d?.model==="CD350","REVIEWED_DRAWER_MODEL_REQUIRED");
    check([0,1].includes(d.pin)&&Number.isInteger(d.on_byte)&&d.on_byte>=1&&d.on_byte<=255&&Number.isInteger(d.off_byte)&&d.off_byte>=1&&d.off_byte<=255,"DOCUMENTED_PULSE_REQUIRED");
    check(Number.isInteger(d.time_unit_ms)&&d.time_unit_ms>0&&d.time_unit_ms<=1000&&typeof d.voltage_v==="string"&&/^\d+(\.\d+)?$/.test(d.voltage_v)&&Number(d.voltage_v)>0,"DOCUMENTED_ELECTRICAL_PROFILE_REQUIRED");
    check(typeof d.electrical_evidence==="string"&&d.electrical_evidence.length>=10,"ELECTRICAL_EVIDENCE_REQUIRED");
  }
  const expires=Math.min(now+seconds*1000,policy.expires_at_ms);check(expires>now,"LAB_AUTHORITY_EXPIRED");
  const body={version:"1.0.0",purpose:"HARDWARE_PHYSICAL_LAB",job_id:randomUUID(),reason:reason.trim(),issued_at_ms:now,expires_at_ms:expires,
    binding:{installation:report.installation,key_fingerprint:report.key_fingerprint,report_nonce:report.report_nonce,usb_name:usbName,descriptor_sha256:usb.descriptor_sha256,vendor:usb.vendor,product:usb.product,interface_index:interfaceIndex,endpoint},profile,kind};
  const bytes=Buffer.from(JSON.stringify(body));check(bytes.length<=11000,"JOB_TOO_LARGE");
  return {body_base64:bytes.toString("base64"),signature_base64:sign("sha256",bytes,privateKey).toString("base64")};
}
function argsMap(argv){const result={};for(let i=0;i<argv.length;i+=2){check(argv[i]?.startsWith("--")&&argv[i+1]!==undefined,"NAMED_ARGUMENTS_REQUIRED");result[argv[i].slice(2)]=argv[i+1];}return result;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {
    const [command,...rest]=process.argv.slice(2),a=argsMap(rest),directory=resolve(a.directory??"artifacts/android-hardware/kit");
    if(command==="init"){
      const policy=initialize(directory,Number(a["trust-hours"]),Number(a["max-job-seconds"]));
      console.log(JSON.stringify({purpose:policy.purpose,authority_sha256:digest(Buffer.from(policy.public_key_spki,"base64")),expires_at_ms:policy.expires_at_ms,assets:join(directory,"assets")},null,2));
    } else if(command==="issue"){
      check(a.report&&a["expected-key-fingerprint"]&&a.profile&&a.output,"REPORT_FINGERPRINT_PROFILE_OUTPUT_REQUIRED");
      const report=readVerifiedReport(objectFile(a.report),a["expected-key-fingerprint"]);
      const envelope=issueJob({policy:objectFile(join(directory,"assets/lab-policy.json")),privateKey:readFileSync(join(directory,"private/authority.pem")),report,usbName:a["usb-name"],interfaceIndex:Number(a.interface),endpoint:Number(a.endpoint),profile:objectFile(a.profile),kind:a.kind,reason:a.reason,seconds:Number(a.seconds)});
      writeFileSync(a.output,JSON.stringify(envelope,null,2),{flag:"wx"});console.log("LAB_JOB_SIGNED: no se ha enviado al hardware; requiere importación y confirmación nativa.");
    } else throw new Error("USE_INIT_OR_ISSUE");
  } catch(error){console.error(error.message);process.exitCode=1;}
}
