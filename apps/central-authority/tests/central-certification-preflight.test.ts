import {it,expect} from "vitest";
import {inspectCentralCertification} from "../src/central-certification-preflight.js";
it("reports missing operational provisioning without making authenticity claims",()=>{
  const result=inspectCentralCertification({});expect(result).toMatchObject({configurationValid:false,tlsIdentityMatched:false,networkVerified:false,humanCertified:false,productionCertified:false});
  expect(result.central.every(r=>!r.present)).toBe(true);expect(result.files.every(r=>!r.regularAbsoluteFile)).toBe(true);
});
it("never serializes supplied passwords, tokens, URLs or managed file paths",()=>{
  const secret="SECRET_SENTINEL_MUST_NOT_LEAK",report=JSON.stringify(inspectCentralCertification({CENTRAL_DATABASE_URL:secret,
    FACTUS_SANDBOX_CLIENT_SECRET:secret,D3_ENROLLMENT_TRANSPORT_TOKEN_FILE:secret,CENTRAL_TLS_KEY_FILE:secret}));
  expect(report).not.toContain(secret);expect(JSON.parse(report).fiscalSandbox.find((f:any)=>f.name==='FACTUS_SANDBOX_CLIENT_SECRET').present).toBe(true);
});
