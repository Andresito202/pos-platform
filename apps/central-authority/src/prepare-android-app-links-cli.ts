import {readFileSync,writeFileSync,lstatSync} from "node:fs";
import {isAbsolute} from "node:path";
import {prepareAndroidAssociation} from "./android-association-preparation.js";
try{
  const [flag,file,outFlag,out]=process.argv.slice(2);
  if(flag!=='--provision'||outFlag!=='--output'||!file||!out||!isAbsolute(file)||!isAbsolute(out)||process.argv.length!==6)throw Error();
  const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error();
  const p=JSON.parse(readFileSync(file,'utf8'));if(Object.keys(p).sort().join(',')!=='registration,signing_certificate_file'||!isAbsolute(p.signing_certificate_file))throw Error();
  const cert=lstatSync(p.signing_certificate_file);if(!cert.isFile()||cert.isSymbolicLink()||cert.size>16384)throw Error();
  const candidate=prepareAndroidAssociation(p.registration,readFileSync(p.signing_certificate_file));
  writeFileSync(out,JSON.stringify(candidate.statements,null,2),{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({status:candidate.publicationStatus,associationPath:candidate.associationPath,callback:candidate.callback})+'\n');
}catch{process.stderr.write('ANDROID_ASSOCIATION_PREPARATION_REJECTED\n');process.exitCode=1;}
