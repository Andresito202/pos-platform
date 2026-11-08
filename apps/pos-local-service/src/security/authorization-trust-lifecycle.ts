import {UuidSchema} from "@pos-platform/contracts";
import type {RuntimeComponent} from "../lifecycle.js";
import type {TrustedSigningKey} from "./license-verifier.js";
import {SessionTrustRefreshComponent,type SessionTrustRefreshReport} from "./session-trust-refresh-component.js";

/** Privileged Service composition dependency, never a serializable message.
 * Implementations must authenticate the entire root-signed set at each read.
 * Production provisioning/wire format requires independent approval. */
export interface PrivilegedAuthorizationTrust {
  readonly binding:Readonly<{installationId:string;deviceId:string}>;
  readKeys():ReadonlyMap<string,TrustedSigningKey>;
  refresh(signal:AbortSignal):Promise<void>;
  destroy():void;
}

/** Reuses the existing scheduler without a second cached key authority. */
export class AuthorizationTrustLifecycle implements RuntimeComponent {
  readonly name="authorization-trust";
  readonly keys:ReadonlyMap<string,TrustedSigningKey>;
  private adapter:PrivilegedAuthorizationTrust|undefined;
  private scheduler:SessionTrustRefreshComponent|undefined;
  private abort:AbortController|undefined;
  private active=false;
  constructor(private readonly binding:Readonly<{installationId:string;deviceId:string}>,
    private readonly provisioning:Readonly<{create:()=>PrivilegedAuthorizationTrust;refreshIntervalMs:number}>|undefined,
    private readonly report:SessionTrustRefreshReport){
    UuidSchema.parse(binding.installationId);UuidSchema.parse(binding.deviceId);
    this.binding=Object.freeze({...binding});
    this.provisioning=provisioning?Object.freeze({...provisioning}):undefined;
    if(provisioning&&(!Number.isSafeInteger(provisioning.refreshIntervalMs)||provisioning.refreshIntervalMs<1000))
      throw Error("SAS_EXPLICIT_REFRESH_POLICY_REQUIRED");
    const owner=this;
    this.keys={get size(){return owner.read().size;},
      get:id=>owner.read().get(id),has:id=>owner.read().has(id),
      entries:()=>owner.read().entries(),keys:()=>owner.read().keys(),values:()=>owner.read().values(),
      [Symbol.iterator]:()=>owner.read()[Symbol.iterator](),
      forEach:(callback,thisArg)=>owner.read().forEach((value,key)=>callback.call(thisArg,value,key,owner.keys)),
    };
  }
  private read():ReadonlyMap<string,TrustedSigningKey>{
    if(!this.active||!this.adapter)return new Map();
    try{this.assertBound(this.adapter);return this.adapter.readKeys();}catch{return new Map();}
  }
  private assertBound(adapter:PrivilegedAuthorizationTrust){
    if(adapter.binding.installationId!==this.binding.installationId||adapter.binding.deviceId!==this.binding.deviceId)
      throw Error("SAS_PROVISIONING_DEVICE_BINDING_REJECTED");
  }
  async start():Promise<void>{
    if(this.active)throw Error("SAS_TRUST_ALREADY_STARTED");
    if(!this.provisioning)return;
    const adapter=this.provisioning.create();
    try{
      this.assertBound(adapter);
      this.adapter=adapter;this.active=true;this.abort=new AbortController();
      const controller=this.abort;
      const scheduler=new SessionTrustRefreshComponent(async()=>{this.assertBound(adapter);await adapter.refresh(controller.signal);},()=>{
        const keys=this.read();return {keys,decision:keys.size?"VALID":"MISSING"};
      },undefined,this.report,this.provisioning.refreshIntervalMs);
      this.scheduler=scheduler;
      await scheduler.refreshNow();
      if(this.active&&!controller.signal.aborted&&this.scheduler===scheduler)await scheduler.start();
    }catch(error){this.active=false;this.adapter=undefined;this.abort?.abort();adapter.destroy();throw error;}
  }
  async refreshNow():Promise<void>{await this.scheduler?.refreshNow();}
  async stop():Promise<void>{
    this.active=false;this.abort?.abort();
    try{await this.scheduler?.stop();}finally{this.adapter?.destroy();this.adapter=undefined;this.scheduler=undefined;}
  }
}
