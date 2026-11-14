import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn,execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {createServer,type Server} from "node:https";
import { describe, expect, it } from "vitest";
import {
  uuidV7,canonicalSessionTrustJson,
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  unsignedAuthorizationTrustBytes,
  unsignedAuthorizationRootTransitionBytes,
  type AuthorizationTrustClaims,
  type SessionAssertionClaims,
} from "@pos-platform/contracts";
import { LocalChannelAuthenticator, LocalChannelClient } from "@pos-platform/local-channel";
import { loadOrCreateWindowsLocalChannelSecret } from "../src/channel/secret.js";
import { unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";

const IDS = {
  installationId: "018f0000-0000-7000-8000-0000000000a2",
  deviceId: "018f0000-0000-7000-8000-0000000000a3",
  userId: "018f0000-0000-7000-8000-0000000000a1",
  tenantId: "018f0000-0000-7000-8000-0000000000a4",
  companyId: "018f0000-0000-7000-8000-0000000000a5",
  branchId: "018f0000-0000-7000-8000-0000000000a6",
};

function sessionAssertion(operational: ReturnType<typeof generateKeyPairSync>): {
  claims: SessionAssertionClaims;
  signature: string;
} {
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 86_400_000).toISOString();
  const claims: SessionAssertionClaims = {
    session_id: "018f0000-0000-7000-8000-0000000000b0",
    user_id: IDS.userId,
    tenant_membership_id: "018f0000-0000-7000-8000-0000000000b1",
    installation_id: IDS.installationId,
    device_id: IDS.deviceId,
    issued_at: issuedAt,
    offline_valid_until: validUntil,
    sequence: 1,
    key_id: "ssa-runtime-01",
  };
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionBytes(claims), operational.privateKey).toString("base64url"),
  };
}

function trustArtifact(root: ReturnType<typeof generateKeyPairSync>, operational: ReturnType<typeof generateKeyPairSync>, version: number, status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED") {
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: "ssa-runtime-01",
    key_purpose: "SESSION_ASSERTION",
    environment: "production",
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
    status,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  });
  return SessionAssertionTrustBundleSchema.parse({
    version,
    keys: [{
      claims,
      signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url"),
    }],
  });
}

async function waitForRuntime(child: ChildProcessWithoutNullStreams): Promise<{ endpoint: string; sessionTrust: string }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("POS Local Service did not reach runtime.started")), 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (const line of buffer.split("\n")) {
        if (!line.includes("runtime.started")) continue;
        try {
          const record = JSON.parse(line) as {
            event?: string;
            fields?: { local_channel_endpoint?: string; session_trust?: string };
          };
          if (record.event !== "runtime.started" || record.fields?.local_channel_endpoint === undefined) continue;
          clearTimeout(timer);
          resolve({
            endpoint: record.fields.local_channel_endpoint,
            sessionTrust: record.fields.session_trust ?? "",
          });
          return;
        } catch {
          // Continue buffering until the structured logger emits a complete line.
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`POS Local Service exited before runtime.started: ${String(code)}; stdout: ${buffer}`));
    });
  });
}

const closedServices = new WeakSet<ChildProcessWithoutNullStreams>();

async function waitForClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (closedServices.has(child)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("close", onClose);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`POS Local Service stdio did not close within ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("close", onClose);
    // Close may have happened between the initial check and listener registration.
    if (closedServices.has(child)) {
      cleanup();
      resolve();
    }
  });
}

async function stopService(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }

  try {
    await waitForClose(child, 10_000);
  } catch {
    if (closedServices.has(child)) return;
    child.kill("SIGKILL");
    await waitForClose(child, 5_000);
  }
}

function spawnService(serviceRoot: string, dataDirectory: string, rootPublicKeyPem: string, artifactPath: string, deployment:NodeJS.ProcessEnv={}): ChildProcessWithoutNullStreams {
  const tsxCli = join(serviceRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, "src/main.ts"], {
    cwd: serviceRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      POS_DATA_DIRECTORY: dataDirectory,
      POS_INSTALLATION_ID: IDS.installationId,
      POS_DEVICE_ID: IDS.deviceId,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: IDS.tenantId,
      POS_COMPANY_ID: IDS.companyId,
      POS_BRANCH_ID: IDS.branchId,
      POS_SESSION_TRUST_ENVIRONMENT: "production",
      POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM: rootPublicKeyPem,
      POS_SESSION_TRUST_ARTIFACT_PATH: artifactPath,
      ...deployment,
    },
  }) as ChildProcessWithoutNullStreams;
  child.once("close", () => closedServices.add(child));
  return child;
}
describe.skipIf(process.platform !== "win32")("G1.2 main runtime bootstrap", () => {
  it("deployment Windows coordinator is mounted by real main and denies missing DEV-003 before transport",async()=>{
    const dir=mkdtempSync(join(process.env.TEMP??process.cwd(),"camacho-commercial-main-")),root=generateKeyPairSync("ed25519"),op=generateKeyPairSync("ed25519"),devRoot=generateKeyPairSync("ed25519"),devKey=generateKeyPairSync("ed25519");
    const artifact=join(dir,"ssa.json"),provision=join(dir,"commercial.json"),origin="https://auth.fixture-commercial.co";
    writeFileSync(artifact,JSON.stringify(trustArtifact(root,op,1,"ACTIVE")));
    const claims={key_id:"DEV_FIXTURE",key_purpose:"DEVICE_TRUST",status:"ACTIVE",version:1,valid_from:new Date(Date.now()-1000).toISOString(),public_key_pem:devKey.publicKey.export({type:"spki",format:"pem"}).toString()};
    writeFileSync(provision,JSON.stringify({profile:"CAMACHO_WINDOWS_COMMERCIAL_V2",environment:"PREPRODUCTION",
      registration:{clientId:"WINDOWS_FIXTURE",platform:"ELECTRON",authorizationOrigin:origin,redirectUri:"http://127.0.0.1:42133/callback"},rp_id:"auth.fixture-commercial.co",webauthn_origin:origin,audience:"FIXTURE",
      request_timeout_ms:1000,attempt_lifetime_ms:2000,maximum_retention_ms:3000,renewal_interval_ms:1000,renewal_before_expiry_ms:2000,
      device_trust_root_public_key_pem:devRoot.publicKey.export({type:"spki",format:"pem"}).toString(),device_trust_root_spki_sha256:createHash("sha256").update(devRoot.publicKey.export({type:"spki",format:"der"})).digest("hex"),
      device_trust_operational_keys:[{claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),devRoot.privateKey).toString("base64url")}]}));
    let service:ChildProcessWithoutNullStreams|undefined,client:LocalChannelClient|undefined,auth:LocalChannelAuthenticator|undefined;
    try{
      service=spawnService(process.cwd(),dir,root.publicKey.export({type:"spki",format:"pem"}).toString(),artifact,{POS_CENTRAL_BASE_URL:origin,POS_WINDOWS_COMMERCIAL_PROVISION_FILE:provision});
      let log="";service.stdout.on("data",chunk=>{log+=chunk.toString();});const ready=await waitForRuntime(service);
      expect(log).toContain('"native_commercial":"MOUNTED"');
      auth=new LocalChannelAuthenticator(loadOrCreateWindowsLocalChannelSecret(dir,IDS.installationId));client=new LocalChannelClient(ready.endpoint,auth,{min:"1.0.0",max:"1.0.0"});
      const envelope=(type:string,payload:unknown)=>({protocol_version:"1.0.0",message_type:type,request_id:uuidV7(),correlation_id:uuidV7(),payload_schema_version:"1.0.0",payload});
      await client.connect(envelope("runtime.handshake",{desktop_version:"1.0.0",service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0",installation_id:IDS.installationId,device_id:IDS.deviceId,schema_version:"5",service_state:"READY"}));
      const response=await client.request(envelope("commercial.native.begin",{state:"s".repeat(43),code_challenge:"c".repeat(43)})) as {error:{code:string}};
      expect(response.error.code).toBe("NATIVE_COMMERCIAL_DENIED");
    }finally{await client?.close();auth?.destroy();if(service)await stopService(service);rmSync(dir,{recursive:true,force:true});}
  },90_000);
  it.each(["file","https"] as const)("boots and restarts the real main with installer-provisioned deployment SAS under DPAPI %s",async mode=>{
    const dir=mkdtempSync(join(process.env.TEMP??process.cwd(),"camacho-sas-main-"));
    const root=generateKeyPairSync("ed25519"),operational=generateKeyPairSync("ed25519"),sasRoot=generateKeyPairSync("ed25519"),sas=generateKeyPairSync("ed25519");
    const artifact=join(dir,"ssa.json"),sasArtifact=join(dir,"sas.json"),provision=join(dir,"sas-provision.json");
    let server:Server|undefined;let requests=0;let issuer="https://central.example.test";
    const transportToken="remote-sas-test-"+crypto.randomUUID()+crypto.randomUUID(),tokenFile=join(dir,"sas-token"),certFile=join(dir,"tls.crt");
    if(mode==="https"){
      const keyFile=join(dir,"tls.key");
      execFileSync("C:/Program Files/Git/usr/bin/openssl.exe",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost","-keyout",keyFile,"-out",certFile],{stdio:"ignore",windowsHide:true});
      writeFileSync(tokenFile,transportToken);
      server=createServer({key:readFileSync(keyFile),cert:readFileSync(certFile),minVersion:"TLSv1.2"},(req,res)=>{
        requests++;
        if(req.url!=="/v1/authorization-trust"||req.headers.authorization!==`Bearer ${transportToken}`){res.writeHead(401);res.end();return;}
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(readFileSync(sasArtifact));
      });
      await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));const address=server.address();
      if(!address||typeof address==="string")throw Error("SAS_HTTPS_FIXTURE_ADDRESS_REQUIRED");issuer=`https://localhost:${address.port}`;
    }
    const recipient={tenant_id:IDS.tenantId,company_id:IDS.companyId,branch_id:IDS.branchId,installation_id:IDS.installationId,device_id:IDS.deviceId};
    const now=Date.now(),from=new Date(now-60_000).toISOString(),until=new Date(now+120_000).toISOString();
    const claims:AuthorizationTrustClaims={profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",schema_version:1,purpose:"AUTHORIZATION_SNAPSHOT",environment:"PREPRODUCTION",issuer,authority_id:"MAIN_SAS_TEST",recipient,generation:2,complete:true,issued_at:from,valid_from:from,valid_until:until,
      keys:[{key_id:"MAIN_SAS_TEST_KEY",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:sas.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",version:1,valid_from:from,valid_until:until}]};
    writeFileSync(artifact,JSON.stringify(trustArtifact(root,operational,1,"ACTIVE")));
    writeFileSync(sasArtifact,JSON.stringify({claims,signature:sign(null,unsignedAuthorizationTrustBytes(claims),sasRoot.privateKey).toString("base64url")}));
    writeFileSync(provision,JSON.stringify({version:1,environment:"PREPRODUCTION",issuer:claims.issuer,authority_id:claims.authority_id,recipient,minimum_generation:2,
      root_public_key_pem:sasRoot.publicKey.export({type:"spki",format:"pem"}).toString(),root_spki_sha256:createHash("sha256").update(sasRoot.publicKey.export({type:"spki",format:"der"})).digest("hex"),
      artifact_path:sasArtifact,refresh_interval_ms:60_000,clock_rollback_tolerance_ms:0,...(mode==="https"?{remote:{transport_token_file:tokenFile,timeout_ms:10_000}}:{})}));
    let service:ChildProcessWithoutNullStreams|undefined;
    try{
      let rolloverRoot:ReturnType<typeof generateKeyPairSync>|undefined;
      for(let restart=0;restart<(mode==="https"?3:2);restart++){
        if(mode==="https"&&restart===1){
          rolloverRoot=generateKeyPairSync("ed25519");
          const fp=(key:typeof sasRoot.publicKey)=>createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
          const transitionClaims={profile:"CAMACHO_SAS_ROOT_TRANSITION_V1" as const,purpose:"AUTHORIZATION_TRUST_ROOT_TRANSITION" as const,issuer,authority_id:claims.authority_id,environment:"PREPRODUCTION" as const,recipient,
            old_root_spki_sha256:fp(sasRoot.publicKey),new_root_spki_sha256:fp(rolloverRoot.publicKey),new_root_public_key_pem:rolloverRoot.publicKey.export({type:"spki",format:"pem"}).toString(),next_minimum_generation:3,issued_at:from,expires_at:until};
          const bytes=unsignedAuthorizationRootTransitionBytes(transitionClaims),nextClaims={...claims,generation:3};
          writeFileSync(sasArtifact,JSON.stringify({transition:{claims:transitionClaims,old_signature:sign(null,bytes,sasRoot.privateKey).toString("base64url"),new_signature:sign(null,bytes,rolloverRoot.privateKey).toString("base64url")},bundle:{claims:nextClaims,signature:sign(null,unsignedAuthorizationTrustBytes(nextClaims),rolloverRoot.privateKey).toString("base64url")}}));
        }
        if(mode==="https"&&restart===2){
          const nextClaims={...claims,generation:4};writeFileSync(sasArtifact,JSON.stringify({claims:nextClaims,signature:sign(null,unsignedAuthorizationTrustBytes(nextClaims),rolloverRoot!.privateKey).toString("base64url")}));
        }
        let output="";service=spawnService(join(import.meta.dirname,".."),dir,root.publicKey.export({type:"spki",format:"pem"}).toString(),artifact,
          {POS_CENTRAL_BASE_URL:claims.issuer,POS_AUTHORIZATION_TRUST_PROVISION_FILE:provision,...(mode==="https"?{NODE_EXTRA_CA_CERTS:certFile}:{})});
        service.stdout.on("data",chunk=>{output+=String(chunk);});
        await waitForRuntime(service);
        const events=output.split("\n").filter(line=>line.includes("authorization_trust.updated")).map(line=>JSON.parse(line));
        expect(events).toHaveLength(1);expect(events[0].fields).toMatchObject({decision:"VALID",key_count:1});
        await stopService(service);service=undefined;
      }
      if(mode==="https")expect(requests).toBeGreaterThanOrEqual(3);
    }finally{if(service)await stopService(service);if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}rmSync(dir,{recursive:true,force:true});}
  },120_000);
  it("boots the real service, activates through the real named pipe, recovers after restart and honors trust revocation", async () => {
    const root = generateKeyPairSync("ed25519");
    const operational = generateKeyPairSync("ed25519");
    const dataDirectory = mkdtempSync(join(process.env.TEMP ?? process.cwd(), "camacho-g12-runtime-"));
    const artifactPath = join(dataDirectory, "session-trust.json");
    const serviceRoot = join(import.meta.dirname, "..");
    const channelSecret = loadOrCreateWindowsLocalChannelSecret(dataDirectory, IDS.installationId);
    const clientAuthenticator = new LocalChannelAuthenticator(channelSecret);
    channelSecret.fill(0);
    let service: ChildProcessWithoutNullStreams | undefined;
    let client: LocalChannelClient | undefined;

    try {
      writeFileSync(artifactPath, JSON.stringify(trustArtifact(root, operational, 1, "ACTIVE")), "utf8");
      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const ready = await waitForRuntime(service);
      expect(ready.sessionTrust).toBe("VALID");

      client = new LocalChannelClient(ready.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });

      const assertion = sessionAssertion(operational);
      const activate = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.activate",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { session_assertion: assertion },
      }) as { status: string };
      expect(activate.status).toBe("SUCCEEDED");

      await client.close();
      await stopService(service);
      service = undefined;

      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const restarted = await waitForRuntime(service);
      expect(restarted.sessionTrust).toBe("VALID");
      client = new LocalChannelClient(restarted.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });

      const recovered = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.recover",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {},
      }) as { status: string };
      expect(recovered.status).toBe("SUCCEEDED");

      await client.close();
      await stopService(service);
      service = undefined;

      writeFileSync(artifactPath, JSON.stringify(trustArtifact(root, operational, 2, "REVOKED")), "utf8");
      service = spawnService(serviceRoot, dataDirectory, root.publicKey.export({ type: "spki", format: "pem" }) as string, artifactPath);
      const revoked = await waitForRuntime(service);
      expect(revoked.sessionTrust).toBe("INVALID");

      client = new LocalChannelClient(revoked.endpoint, clientAuthenticator, { min: "1.0.0", max: "1.0.0" });
      await client.connect({
        protocol_version: "1.0.0",
        message_type: "runtime.handshake",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: {
          desktop_version: "1.0.0",
          service_version: "1.0.0",
          protocol_min: "1.0.0",
          protocol_max: "1.0.0",
          installation_id: IDS.installationId,
          device_id: IDS.deviceId,
          schema_version: "5",
          service_state: "READY",
        },
      });
      const rejected = await client.request({
        protocol_version: "1.0.0",
        message_type: "session.activate",
        request_id: crypto.randomUUID(),
        correlation_id: crypto.randomUUID(),
        payload_schema_version: "1.0.0",
        payload: { session_assertion: assertion },
      }) as { status: string };
      expect(rejected.status).toBe("REJECTED");
    } finally {
      await client?.close().catch(() => undefined);
      if (service !== undefined) {
        await stopService(service);
      }
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  }, 90_000);
});
