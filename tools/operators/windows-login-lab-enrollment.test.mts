import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {renderLabEnrollmentPage} from "./windows-login-lab-enrollment.mts";

test("first enrollment renders new-account inputs",()=>{
 const html=renderLabEnrollmentPage("nonce",false);
 assert.match(html,/name="name"/);
 assert.match(html,/autocomplete="new-password"/);
 assert.match(html,/Registrar autenticador/);
 assert.match(html,/input\.name=form\.elements\.name\.value/);
});

test("resume revocation qualifies the role-assignment version column",async()=>{
 const source=await readFile(new URL("./windows-login-lab-enrollment.mts",import.meta.url),"utf8");
 assert.match(source,/version=pra\.version\+1/);
});

test("resume uses separate audit ids for revoking and recreating the temporary role",async()=>{
 const source=await readFile(new URL("./windows-login-lab-enrollment.mts",import.meta.url),"utf8");
 const revoke=source.indexOf("version=pra.version+1 FROM");
 const nextAudit=source.indexOf("set_config('app.audit_id',$1,true)",revoke);
 const recreate=source.indexOf("platform_role_assignments(id,user_id,role_id,status",revoke);
 assert.ok(revoke>=0&&nextAudit>revoke&&recreate>nextAudit);
});

test("repeated resume resolves the stable lab role through the enrolled user",async()=>{
 const source=await readFile(new URL("./windows-login-lab-enrollment.mts",import.meta.url),"utf8");
 const start=source.indexOf("if(pendingReceipt){");
 const end=source.indexOf("}else{",start);
 const resume=source.slice(start,end);
 assert.match(resume,/FROM "authorization"\.roles r WHERE r\.code='LAB_ENROLLMENT_OPERATOR'/);
 assert.match(resume,/EXISTS\(SELECT 1 FROM "authorization"\.platform_role_assignments pra WHERE pra\.role_id=r\.id AND pra\.user_id=\$1\)/);
 assert.doesNotMatch(resume,/WHERE pra\.id=\$1 AND pra\.user_id=\$2/);
});

test("pending enrollment renders password-verified resume without name creation",()=>{
 const html=renderLabEnrollmentPage("nonce",true);
 assert.doesNotMatch(html,/name="name"/);
 assert.match(html,/autocomplete="current-password"/);
 assert.match(html,/Reanuda el registro de tu autenticador/);
 assert.match(html,/const input=\{ticket,email:form\.elements\.email\.value,password\};/);
 assert.doesNotMatch(html,/input\.name=form\.elements\.name\.value/);
 assert.match(html,/timeout:300000/);
});

test("resume leaves authenticator choice to the PC and keeps user verification required",()=>{
 const html=renderLabEnrollmentPage("nonce",true);
 assert.match(html,/authenticatorSelection:\{userVerification:"required",residentKey:"preferred"\}/);
 assert.match(html,/userVerification:"required"/);
 assert.match(html,/Si ofrece Android u otro dispositivo, escanea el QR con tu Motorola/);
 assert.match(html,/Contraseña original usada al crear la cuenta de Camacho POS/);
 assert.doesNotMatch(html,/authenticatorAttachment:/);
});
test("a failed WebAuthn ceremony cannot resubmit the consumed capability",()=>{
 const html=renderLabEnrollmentPage("nonce",true);
 assert.match(html,/solicita un enlace de reanudación nuevo/);
 assert.match(html,/button\.disabled=true/);
 assert.match(html,/LAB_CREDENTIALS_REJECTED/);
 assert.match(html,/LAB_OPERATOR_CAPABILITY_REQUIRED/);
 assert.match(html,/LAB_REAL_WEBAUTHN_REGISTRATION_REJECTED/);
});
