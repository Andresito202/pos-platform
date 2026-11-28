import {createHash,generateKeyPairSync} from "node:crypto";
import assert from "node:assert/strict";
import {createPostgresPool} from "@pos-platform/database-postgres";
import {once} from "node:events";
import {createServer,request as httpsRequest} from "node:https";
import {uuidV7 as id,canonicalSessionTrustJson,LICENSE_LOCAL_ACCEPTANCE_PATH} from "@pos-platform/contracts";
import {createDeviceRequestAuthorization} from "@pos-platform/device-trust";
import {LicenseCapacityAuthority,LICENSE_ACTIVATION_PATH} from "../../src/license-capacity-authority.js";
import {createLicenseCapacityHandler} from "../../src/license-capacity-runtime.js";
import {businessTestTls} from "./business-test-tls.js";

const connection=process.env.CASH_BINDING_PROBE_URL;
const adminConnection=process.env.CASH_BINDING_PROBE_ADMIN_URL;
if(!connection||!adminConnection)throw Error("DISPOSABLE_TEST_SERVER_REQUIRED");
const url=new URL(connection),adminUrl=new URL(adminConnection);
if(url.hostname!=="127.0.0.1"||["5432","55433",""].includes(url.port)||
   !/^\/test_cash_binding_[a-f0-9]+$/.test(url.pathname)||
   url.host!==adminUrl.host||url.pathname!==adminUrl.pathname||url.username!=="pos_platform_app"){
  throw Error("DISPOSABLE_TEST_SERVER_REQUIRED");
}
const {tenant,company,branch,licenseId}=JSON.parse(process.argv[2]!) as {tenant:string;company:string;branch:string;licenseId:string};
const root=createPostgresPool(adminConnection,2),runtime=createPostgresPool(connection,4);
try {
  const register=id();
  await root.query(`INSERT INTO cash.cash_registers(id,tenant_id,company_id,branch_id,code,code_normalized,name,currency_code,status)
    VALUES($1::uuid,$2,$3,$4,$1::text,$1::text,'Test only','COP','ACTIVE')`,[register,tenant,company,branch]);
  const client=await runtime.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
    await client.query("INSERT INTO licensing.cash_register_bindings(register_id,tenant_id,company_id,branch_id,license_id) VALUES($1,$2,$3,$4,$5)",
      [register,tenant,company,branch,licenseId]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  const installation=id(), device=id(), credential=id(), activationId=id(), keyId="TEST_"+id().replaceAll("-","").toUpperCase();
  const deviceKey=generateKeyPairSync("ed25519"), signingKey=generateKeyPairSync("ed25519");
  const pem=(key:typeof deviceKey.publicKey)=>Buffer.from(key.export({type:"spki",format:"pem"}));
  const sha=(contents:Buffer|string)=>createHash("sha256").update(contents).digest();
  await root.query(`INSERT INTO identity.device_registry
    (device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at)
    VALUES($1::uuid,$2,$3,$4,$1::text,$5,'Ed25519','ACTIVE','TEST_TRUST','DEVICE_TRUST',now(),now())`,
  [device,installation,tenant,company,pem(deviceKey.publicKey)]);
  await root.query(`INSERT INTO identity.device_credentials
    (credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at)
    VALUES($1,$2::uuid,$3,$4,$5,$2::text,'TEST_TRUST','DEVICE_TRUST','ACTIVE',1,now(),now()+interval '1 hour',$6,$7,now())`,
  [credential,device,installation,tenant,company,sha(credential).toString("hex"),Buffer.alloc(64)]);
  await root.query(`INSERT INTO licensing.trusted_signing_keys
    (key_id,key_purpose,environment,public_key,public_key_checksum,algorithm_id,key_status,valid_from,valid_until)
    VALUES($1,'LICENSE','PREPRODUCTION',$2,$3,'Ed25519','ACTIVE',now()-interval '1 minute',now()+interval '1 hour')`,
  [keyId,pem(signingKey.publicKey),sha(signingKey.publicKey.export({type:"spki",format:"der"}))]);
  const policy={profile:"CAMACHO_LICENSE_ACTIVATION_V1",policy_reference:"TEST_ONLY",subscription_grace_days:3,
    grace_basis:"ELAPSED_24_HOURS",perpetual_use:"NO_EXPIRY",support_and_external_services:"SEPARATE",
    accepted_contract_policy_references:["TEST_ONLY"],offline_capabilities:["CASH_REGISTER"]};
  const allocation=canonicalSessionTrustJson({license_id:licenseId,credential_id:credential,policy,
    allocations:[{register_id:register,branch_id:branch}]});
  await root.query(`INSERT INTO licensing.license_activations
    (id,license_id,tenant_id,company_id,device_id,installation_id,credential_id,activation_status,payload_version,license_version,
     request_payload,request_checksum,idempotency_key,signing_key_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',2,1,$8::jsonb,$9,$10,$11)`,
  [activationId,licenseId,tenant,company,device,installation,credential,allocation,sha(allocation),id(),keyId]);
  const authority=new LicenseCapacityAuthority(runtime,policy,{keyId,privateKey:signingKey.privateKey,environment:"PREPRODUCTION"},
    {reauthenticationMs:30_000,lockTimeoutMs:3_000,statementTimeoutMs:10_000});
  const tls=businessTestTls();
  const api=createServer(tls);
  api.listen(0,"127.0.0.1");
  await once(api,"listening");
  try{
    const address=api.address();
    if(!address||typeof address==="string")throw Error("MISSING_TEST_ADDRESS");
    const origin=`https://127.0.0.1:${address.port}`;
    api.on("request",createLicenseCapacityHandler(authority,origin,{requests:50,buckets:5,windowMs:60_000}));
    function proof(path:string,body:Record<string,string>){
      const raw=JSON.stringify(body),requestId=id(),correlationId=id();
      const authorization=createDeviceRequestAuthorization({method:"POST",path,body:raw,requestId,correlationId,credentialId:credential},deviceKey.privateKey);
      return {raw,headers:{authorization,"x-request-id":requestId,"x-correlation-id":correlationId,"content-type":"application/json","content-length":Buffer.byteLength(raw)}};
    }
    function post(path:string, signed:ReturnType<typeof proof>){
      return new Promise<{status:number|undefined;body:any}>((resolve,reject)=>{
        const native=httpsRequest(origin+path,{method:"POST",ca:tls.cert,headers:signed.headers},response=>{
          const chunks:Buffer[]=[];
          response.on("data",chunk=>chunks.push(chunk));
          response.on("error",reject);
          response.on("end",()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString("utf8"))}));
        });
        native.on("error",reject).end(signed.raw);
      });
    }
    const ack=(payloadChecksum:string)=>proof(LICENSE_LOCAL_ACCEPTANCE_PATH,{activationId,payloadChecksum});
    const send=(signed:ReturnType<typeof proof>)=>post(LICENSE_LOCAL_ACCEPTANCE_PATH,signed);
    assert.equal((await send(ack("a".repeat(64)))).status,403);
    const issued=await post(LICENSE_ACTIVATION_PATH,proof(LICENSE_ACTIVATION_PATH,{activationId}));
    assert.equal(issued.status,200);
    const payloadChecksum=sha(canonicalSessionTrustJson(issued.body.artifact.claims)).toString("hex");
    assert.equal((await send(ack("b".repeat(64)))).status,403);
    const firstProof=ack(payloadChecksum);
    const accepted=await Promise.all([send(firstProof),send(ack(payloadChecksum))]);
    assert.deepEqual(accepted.map(result=>result.status),[200,200]);
    assert.equal(accepted[0]!.body.activationId,activationId);
    assert.equal(accepted[0]!.body.payloadChecksum,payloadChecksum);
    assert.deepEqual(accepted[1]!.body,accepted[0]!.body);
    assert.equal((await send(firstProof)).status,403);
    const receipts=await root.query(`SELECT id FROM identity.device_authentication_events
      WHERE device_id=$1 AND reason_code='LICENSE_CAPACITY_ACCEPTED_LOCALLY' AND evidence_checksum=$2`,[device,payloadChecksum]);
    assert.deepEqual(receipts.rows,[{id:accepted[0]!.body.receiptId}]);
    await root.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=now(),revoked_reason='TEST' WHERE credential_id=$1",[credential]);
    assert.equal((await send(ack(payloadChecksum))).status,403);
    process.stdout.write(JSON.stringify({issued:true,accepted:true,concurrentReceipts:receipts.rowCount,replayRejected:true,revokedRejected:true}));
  }finally{
    await new Promise<void>((resolve,reject)=>api.close(error=>error?reject(error):resolve()));
  }
}finally{await Promise.all([root.end(),runtime.end()]);}
