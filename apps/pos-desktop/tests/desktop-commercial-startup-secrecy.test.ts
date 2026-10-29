import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const startup=readFileSync(new URL("../src/start.ts",import.meta.url),"utf8");
const entry=readFileSync(new URL("../src/production-entry.ts",import.meta.url),"utf8");

describe("Windows commercial Electron startup custody regressions",()=>{
  it("keeps the main authenticated Service connection and account channel distinct",()=>{
    expect(startup).toContain("const authenticator = options.channelSecret===undefined?undefined:new LocalChannelAuthenticator(options.channelSecret)");
    expect(startup).toContain("const nativeAuthenticator=new LocalChannelAuthenticator(options.channelSecret!)");
    expect(startup).toContain("await connectLocalServiceChannel({");
    expect(startup).toContain("new DesktopCommercialAccount(");
    expect(startup).toContain("createElectronBusinessCredentialVault()");
  });
  it("closes the authenticated channel on any startup failure after handshake",()=>{
    expect(startup).toContain("try{await channel.close();}catch");
    expect(startup).toContain("authenticator?.destroy()");
    expect(startup).toContain("options.channelSecret?.fill(0)");
    expect(startup).toContain("throw error;");
  });
  it("zeroizes both the channel authenticator and launcher secret when Electron quits",()=>{
    const cleanup=startup.slice(startup.indexOf('app.once("will-quit"'));
    expect(cleanup).toContain("authenticator?.destroy()");
    expect(cleanup).toContain("options.channelSecret?.fill(0)");
    expect(entry).toContain("provisioning.channelSecret.fill(0)");
    expect(entry).toContain('console.error("POS_DESKTOP_BOOTSTRAP_FAILED")');
    expect(entry).toContain("process.exitCode = 1");
    expect(entry).toContain("app.quit()");
    expect(entry).not.toContain('console.error("production desktop bootstrap failed", error)');
  });
  it("fails closed before Electron startup if DPAPI provisioning cannot be loaded",()=>{
    expect(entry).toContain("try {");
    expect(entry).toContain("provisioning = loadProductionDesktopProvisioning()");
    expect(entry).toContain('console.error("POS_DESKTOP_PROVISIONING_FAILED")');
    expect(entry).toContain("process.exitCode = 1");
    expect(entry).toContain("app.quit()");
    expect(entry).not.toContain("console.error(error)");
    expect(entry).not.toContain("console.error(err)");
  });
  it("does not substitute unauthenticated IPC or persist the shared secret in renderer state",()=>{
    expect(startup).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    expect(startup).not.toContain("localStorage");
    expect(startup).not.toContain("new BrowserWindow(");
    expect(startup).not.toContain("allowInsecure");
  });
});
