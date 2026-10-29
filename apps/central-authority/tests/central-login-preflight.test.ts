import {describe,it,expect} from "vitest";
import {inspectCentralLoginPreflight} from "../src/central-login-preflight.js";

describe("BUSINESS/GLOBAL operator readiness",()=>{
  it("blocks without authentic deployment and never reports MFA/session certification",()=>{
    const report=inspectCentralLoginPreflight({});
    expect(report.scope).toBe("BUSINESS_GLOBAL_LOGIN_OFFLINE_READ_ONLY");
    expect(report.status).toBe("BLOCKED_BY_CONFIGURATION");
    expect(report.configuredLocally).toBe(false);
    expect(report.centralDatabaseVerified).toBe(false);
    expect(report.windowsServiceVerified).toBe(false);
    expect(report.physicalMfaVerified).toBe(false);
    expect(report.sasSsaVerified).toBe(false);
    expect(report.humanCertified).toBe(false);
    expect(report.missingConfiguration).toContain("CENTRAL_AUTHORITY_ORIGIN");
    expect(report.missingFiles).toContain("CENTRAL_COMMERCIAL_PROVISION_FILE");
    expect(report.missingFiles).toContain("CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE");
  });
  it("does not demand optional SSA transport without an operator-selected distribution channel",()=>{
    const report=inspectCentralLoginPreflight({});
    expect(report.missingFiles).not.toContain("SESSION_TRUST_TRANSPORT_TOKEN_FILE");
    expect(report.missingFiles).toContain("AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE");
    expect(report.configuredLocally).toBe(false);
  });
  it("rejects LOCAL even if the code supports local enrollment for another purpose",()=>{
    const report=inspectCentralLoginPreflight({CENTRAL_DEPLOYMENT_ENVIRONMENT:"LOCAL"});
    expect(report.environmentAllowed).toBe(false);
    expect(report.status).toBe("BLOCKED_BY_CONFIGURATION");
  });
  it("does not mix fiscal, licensing or payment custody into the login P0",()=>{
    const report=inspectCentralLoginPreflight({});
    const serialized=JSON.stringify(report);
    expect(serialized).not.toContain("FACTUS");
    expect(serialized).not.toContain("LICENSE_ACTIVATION");
    expect(serialized).not.toContain("fiscalSandbox");
    expect(serialized).not.toContain("PASSWORD");
  });
  it("does not leak environment values, even if malformed",()=>{
    const value="DO_NOT_PRINT_THIS_SENTINEL";
    const report=inspectCentralLoginPreflight({CENTRAL_AUTHORITY_ORIGIN:value,CENTRAL_DATABASE_URL:value});
    expect(JSON.stringify(report)).not.toContain(value);
    expect(report.configuredLocally).toBe(false);
    expect(report.status).toBe("BLOCKED_BY_CONFIGURATION");
  });
});
