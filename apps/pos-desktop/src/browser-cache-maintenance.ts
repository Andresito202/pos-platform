import type {Session} from "electron";
export interface BrowserCachePolicy{maximum_cache_bytes:number;interval_ms:number;}
/** Chromium HTTP cache only. No cookies, storage, auth, SQLite, outbox, audit,
 * watermarks or DPAPI deletion. Caller supplies an explicit operational policy. */
export class BrowserCacheMaintenance{
  private timer:ReturnType<typeof setInterval>|undefined;
  private pending:Promise<{cleared:boolean;before_bytes:number;after_bytes:number;elapsed_ms:number}>|undefined;
  constructor(private readonly browser:Pick<Session,"getCacheSize"|"clearCache">,private readonly policy:BrowserCachePolicy){
    if(!Number.isSafeInteger(policy.maximum_cache_bytes)||policy.maximum_cache_bytes<=0||!Number.isSafeInteger(policy.interval_ms)||
      policy.interval_ms<1000||policy.interval_ms>2147483647)throw Error("BROWSER_CACHE_EXPLICIT_POLICY_REQUIRED");
  }
  start(){if(!this.timer){this.timer=setInterval(()=>{void this.run().catch(()=>undefined);},this.policy.interval_ms);this.timer.unref?.();}}
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.pending?.catch(()=>undefined);}
  run(force=false){
    if(this.pending)return this.pending;
    const work=(async()=>{const started=performance.now(),before=await this.browser.getCacheSize();
      if(!Number.isSafeInteger(before)||before<0)throw Error("BROWSER_CACHE_MEASUREMENT_REJECTED");
      const cleared=force||before>this.policy.maximum_cache_bytes;if(cleared)await this.browser.clearCache();
      const after=await this.browser.getCacheSize();if(!Number.isSafeInteger(after)||after<0)throw Error("BROWSER_CACHE_MEASUREMENT_REJECTED");
      return {cleared,before_bytes:before,after_bytes:after,elapsed_ms:performance.now()-started};})();
    this.pending=work;void work.then(()=>{if(this.pending===work)this.pending=undefined;},()=>{if(this.pending===work)this.pending=undefined;});return work;
  }
}
