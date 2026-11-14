const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_BUCKETS_MAX = 10_000;

/** In-memory fixed-window limiter for a single service process. */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; startedAt: number }>();
  private nextSweep=0;
  constructor(private readonly maximum=RATE_LIMIT_MAX,private readonly capacity=RATE_LIMIT_BUCKETS_MAX,
    private readonly windowMs=RATE_LIMIT_WINDOW_MS){
    if(![maximum,capacity,windowMs].every(n=>Number.isSafeInteger(n)&&n>0))throw Error("RATE_LIMIT_POLICY_REQUIRED");
  }
  get retainedBuckets(){return this.buckets.size;}
  /** Safe manual/automatic maintenance: never removes an active abuse budget. */
  pruneExpired(now=Date.now()):number{
    if(!Number.isFinite(now))throw Error("RATE_LIMIT_CLOCK_REQUIRED");
    let removed=0;for(const [key,bucket] of this.buckets)if(now-bucket.startedAt>=this.windowMs){this.buckets.delete(key);removed++;}
    return removed;
  }

  allow(key: string, now = Date.now()): boolean {
    if(!Number.isFinite(now)||typeof key!=="string"||!key||key.length>256)return false;
    if(now>=this.nextSweep){this.pruneExpired(now);this.nextSweep=now+this.windowMs;}
    let existing = this.buckets.get(key);
    if(existing&&now<existing.startedAt)return false;
    if(existing&&now-existing.startedAt>=this.windowMs){this.buckets.delete(key);existing=undefined;}
    if (!existing) {
      // Capacity pressure denies new keys. Evicting an active key would reset
      // its budget and let address churn bypass an already enforced limit.
      if (this.buckets.size >= this.capacity)return false;
      this.buckets.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (existing.count >= this.maximum) return false;
    existing.count += 1;
    return true;
  }
}
