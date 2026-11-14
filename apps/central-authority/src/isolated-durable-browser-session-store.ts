import type {Pool} from "@pos-platform/database-postgres";
import {BusinessAccessPreparation} from "./business-access-preparation.js";
import {DurableBrowserSessionStore} from "./durable-browser-session-store.js";

/** Compatibility profile for existing disposable fixtures; never canonical DDL. */
export class IsolatedDurableBrowserSessionStore extends DurableBrowserSessionStore{
  constructor(pool:Pool,origin:string){
    super(pool,origin,{mode:"ISOLATED_VALIDATION",lifetimeMs:300_000,idleTimeoutMs:300_000,maximumReauthenticationAgeMs:300_000});
  }
  async establish(preparation:BusinessAccessPreparation,reference:unknown){
    if(!(preparation instanceof BusinessAccessPreparation))return null;
    const binding=await preparation.resolveCurrent(reference);
    return binding?this.establishValidation(binding):null;
  }
}
