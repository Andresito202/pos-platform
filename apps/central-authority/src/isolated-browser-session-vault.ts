import {createHash,randomBytes,timingSafeEqual} from "node:crypto";

/**
 * In-memory, single-process lab session store. Only the opaque cookie ID travels
 * to the browser: BUSINESS preparation references remain in this WeakMap-backed
 * server process. No production persistence, clustering or public routes.
 */
const COOKIE="__Host-camacho_business";
const MAX_SESSIONS=512;
const TTL_MS=5*60_000;
type Entry={readonly reference:object;readonly csrfHash:Buffer;readonly origin:string;readonly expiresAt:number};
const digest=(s:string)=>createHash("sha256").update(s).digest();
const opaque=()=>randomBytes(32).toString("base64url");
const cookie=(id:string,maxAge:number)=>`${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
const same=(left:Buffer,right:Buffer)=>left.byteLength===right.byteLength&&timingSafeEqual(left,right);

export class IsolatedBrowserSessionVault {
  private readonly records=new Map<string,Entry>();
  constructor(private readonly trustedOrigin:string,private readonly now:()=>number=()=>Date.now()){
    let u:URL;
    try {u=new URL(trustedOrigin);}catch {throw Error("BROWSER_SESSION_HTTPS_ORIGIN_REQUIRED");}
    if(u.protocol!=="https:"||u.origin!==trustedOrigin||u.pathname!=="/"||u.search||u.hash||
      u.username||u.password||u.hostname==="localhost"||u.hostname==="127.0.0.1")
      throw Error("BROWSER_SESSION_HTTPS_ORIGIN_REQUIRED");
  }
  acceptsOrigin(origin:unknown):boolean{return origin===this.trustedOrigin;}
  private tokenFromCookie(raw:string|null):string|null{
    if(typeof raw!=="string"||raw.length>8192)return null;
    const items=raw.split(";");
    const matches=items.map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+"="));
    if(matches.length!==1)return null;
    const id=matches[0]!.slice(COOKIE.length+1);
    return /^[A-Za-z0-9_-]{43}$/.test(id)?id:null;
  }
  private lookup(rawCookie:string|null):{id:string;entry:Entry}|null{
    const id=this.tokenFromCookie(rawCookie);
    if(!id)return null;
    const entry=this.records.get(digest(id).toString("hex"));
    if(!entry)return null;
    if(entry.expiresAt<=this.now()){
      this.records.delete(digest(id).toString("hex"));return null;
    }
    return {id,entry};
  }
  /** Always creates a fresh random cookie after completed human MFA. */
  establish(reference:unknown,origin:string):{setCookie:string;csrfToken:string}|null{
    if(!reference||typeof reference!=="object"||origin!==this.trustedOrigin)return null;
    const csrfToken=opaque(),id=opaque();
    if(this.records.size>=MAX_SESSIONS){
      for(const [key,entry] of this.records){if(entry.expiresAt<=this.now())this.records.delete(key);}
      if(this.records.size>=MAX_SESSIONS)throw Error("BROWSER_SESSION_CAPACITY_REACHED");
    }
    this.records.set(digest(id).toString("hex"),{
      reference,csrfHash:digest(csrfToken),origin,expiresAt:this.now()+TTL_MS,
    });
    return {setCookie:cookie(id,Math.floor(TTL_MS/1000)),csrfToken};
  }
  /** Unsafe actions require exact origin, CSRF header and same-host fetch context. */
  inspect(input:{cookie:string|null;origin:string|null;csrfToken:string|null;
    fetchSite:string|null;method:string}):object|null{
    if(input.origin!==this.trustedOrigin||!["POST","DELETE"].includes(input.method)||
      input.fetchSite!=="same-origin"||typeof input.csrfToken!=="string"||
      !/^[A-Za-z0-9_-]{43}$/.test(input.csrfToken))return null;
    const match=this.lookup(input.cookie);if(!match||match.entry.origin!==input.origin)return null;
    return same(digest(input.csrfToken),match.entry.csrfHash)?match.entry.reference:null;
  }
  /** Rotates cookie and CSRF atomically in-process: previous ID stops working. */
  rotate(input:{cookie:string|null;origin:string|null;csrfToken:string|null;
    fetchSite:string|null;method:string}):{setCookie:string;csrfToken:string}|null{
    const reference=this.inspect(input),old=this.tokenFromCookie(input.cookie);
    if(!reference||!old)return null;
    this.records.delete(digest(old).toString("hex"));
    return this.establish(reference,this.trustedOrigin);
  }
  logout(input:{cookie:string|null;origin:string|null;csrfToken:string|null;
    fetchSite:string|null;method:string}):{clearCookie:string;reference:object}|null{
    const reference=this.inspect(input),id=this.tokenFromCookie(input.cookie);
    if(!reference||!id)return null;
    this.records.delete(digest(id).toString("hex"));
    return {reference,clearCookie:cookie("",0)};
  }
}
