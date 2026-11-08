import { createHash,createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  SignedAuthorizationTrustCandidateSchema, SignedAuthorizationTrustSchema, canonicalSessionTrustJson,
  type SignedAuthorizationTrustCandidate, type SignedAuthorizationTrust, type AuthorizationTrustClaims,
  AuthorizationTrustProtectedStateSchema,SignedAuthorizationRootTransitionSchema,unsignedAuthorizationRootTransitionBytes,type SignedAuthorizationRootTransition,
} from "@pos-platform/contracts";
import type { EncryptedFileSecretStore } from "./encrypted-secret-store.js";
import type { TrustedSigningKey } from "./license-verifier.js";
import type { TrustedClockGuard } from "./trusted-clock.js";
import { assertAuthorizationTrustSeparated } from "./authorization-trust-separation.js";

type CandidatePolicy={mode:"ISOLATED_VALIDATION";issuer:string;authorityId:string;environment:"isolated-validation";minimumGeneration:number;root:KeyObject};
export type AuthorizationTrustDeploymentPolicy={mode:"DEPLOYMENT";issuer:string;authorityId:string;environment:"PREPRODUCTION"|"PRODUCTION";minimumGeneration:number;root:KeyObject;recipient:AuthorizationTrustClaims["recipient"]};
const rank = { ACTIVE: 0, VERIFY_ONLY: 1, REVOKED: 2 };
const material = (key: KeyObject) => key.export({ type: "spki", format: "der" }).toString("hex");
const fingerprint=(key:KeyObject)=>createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
type TransitionEntry={transition:SignedAuthorizationRootTransition;accepted_at:string};

/** Single-writer Service owner. Synchronous read/check/atomic replace cannot
 * interleave within that owner. This is not a cross-process locking protocol.
 * OS-bound persistence protects the retained watermark, not administrator-led
 * restoration of an entire machine backup; the pinned bootstrap floor remains
 * an explicit input. Deployment root/floor come only from trusted provisioning. */
export class AuthorizationTrustStore {
  constructor(
    private readonly secrets: EncryptedFileSecretStore,
    private readonly policy: CandidatePolicy|AuthorizationTrustDeploymentPolicy,
    private readonly sessionKeys: ReadonlyMap<string, TrustedSigningKey>,
    private readonly clock: TrustedClockGuard,
    private readonly now: () => Date,
  ) {
    if (!(policy.mode==="ISOLATED_VALIDATION"&&policy.environment==="isolated-validation" ||
      policy.mode==="DEPLOYMENT"&&["PREPRODUCTION","PRODUCTION"].includes(policy.environment)) ||
      !Number.isSafeInteger(policy.minimumGeneration) || policy.minimumGeneration < 1 ||
      policy.root.type !== "public" || policy.root.asymmetricKeyType !== "ed25519" || secrets.protection !== "OS_BOUND")
      throw Error("SAS_LAB_OS_BOUND_ROOT_POLICY_REQUIRED");
    // Freeze a private copy: changing a caller-owned policy cannot change trust.
    this.policy = Object.freeze({ ...policy,...(policy.mode==="DEPLOYMENT"?{recipient:Object.freeze({...policy.recipient})}:{}) });
  }

  private get secret(){return this.policy.mode==="DEPLOYMENT"?"authorization-trust-v1":"authorization-trust-lab-candidate";}

  private chain(entries:TransitionEntry[]){
    if(!entries.length)return {root:this.policy.root,floor:0};
    let root=this.policy.root,floor=0,accepted=0;const seen=new Set([fingerprint(root)]);
    if(entries.length>32||entries.length&&this.policy.mode!=="DEPLOYMENT")throw Error("SAS_ROOT_CHAIN_REJECTED");
    for(const entry of entries){
      const t=SignedAuthorizationRootTransitionSchema.parse(entry.transition),c=t.claims;
      const next=createPublicKey(c.new_root_public_key_pem),bytes=unsignedAuthorizationRootTransitionBytes(c),at=Date.parse(entry.accepted_at);
      if(this.policy.mode!=="DEPLOYMENT"||next.asymmetricKeyType!=="ed25519"||next.type!=="public"||
        !verify(null,bytes,root,Buffer.from(t.old_signature,"base64url"))||!verify(null,bytes,next,Buffer.from(t.new_signature,"base64url"))||
        c.old_root_spki_sha256!==fingerprint(root)||c.new_root_spki_sha256!==fingerprint(next)||seen.has(fingerprint(next))||
        c.issuer!==this.policy.issuer||c.authority_id!==this.policy.authorityId||c.environment!==this.policy.environment||
        canonicalSessionTrustJson(c.recipient)!==canonicalSessionTrustJson(this.policy.recipient)||c.next_minimum_generation<=floor||
        !Number.isFinite(at)||at<accepted||at<Date.parse(c.issued_at)||at>=Date.parse(c.expires_at)||at>this.now().getTime())throw Error("SAS_ROOT_CHAIN_REJECTED");
      seen.add(fingerprint(next));root=next;floor=c.next_minimum_generation;accepted=at;
    }
    return {root,floor};
  }
  private state():{bundle:unknown;transitions:TransitionEntry[]}|null{
    if(!this.secrets.has(this.secret))return null;
    const raw:unknown=JSON.parse(this.secrets.read(this.secret).toString("utf8"));
    if(this.policy.mode==="DEPLOYMENT"&&typeof raw==="object"&&raw!==null&&"profile" in raw&&raw.profile==="SAS_TRUST_PROTECTED_STATE_V2"){
      const parsed=AuthorizationTrustProtectedStateSchema.parse(raw);return {bundle:parsed.bundle,transitions:parsed.transitions};
    }
    return {bundle:raw,transitions:[]};
  }
  private write(bundle:SignedAuthorizationTrustCandidate|SignedAuthorizationTrust,transitions:TransitionEntry[]){
    const value=transitions.length?AuthorizationTrustProtectedStateSchema.parse({profile:"SAS_TRUST_PROTECTED_STATE_V2",bundle,transitions}):bundle;
    this.secrets.write(this.secret,Buffer.from(JSON.stringify(value)));
  }
  private check(input: unknown, requireCurrent: boolean,transitions:TransitionEntry[]=[]): SignedAuthorizationTrustCandidate|SignedAuthorizationTrust {
    const bundle = (this.policy.mode==="DEPLOYMENT"?SignedAuthorizationTrustSchema:SignedAuthorizationTrustCandidateSchema).parse(input), c = bundle.claims;
    // Authenticate the whole set BEFORE interpreting generation or revocation.
    const chain=this.chain(transitions);
    if (!verify(null, Buffer.from(canonicalSessionTrustJson(c)), chain.root, Buffer.from(bundle.signature, "base64url")))
      throw Error("SAS_ROOT_SIGNATURE_INVALID");
    if (c.issuer !== this.policy.issuer || c.authority_id !== this.policy.authorityId ||
      c.environment !== this.policy.environment || c.generation<chain.floor || requireCurrent && c.generation < this.policy.minimumGeneration)
      throw Error("SAS_TRUST_BINDING_REJECTED");
    if(this.policy.mode==="DEPLOYMENT"&&(!("recipient" in c)||canonicalSessionTrustJson(c.recipient)!==canonicalSessionTrustJson(this.policy.recipient)))
      throw Error("SAS_TRUST_RECIPIENT_REJECTED");
    const now = this.now(); this.clock.accept(now);
    if (requireCurrent && (now.getTime() < Date.parse(c.valid_from) || now.getTime() >= Date.parse(c.valid_until)))
      throw Error("SAS_TRUST_WINDOW_REJECTED");
    const keys = new Map<string, TrustedSigningKey>(), materials = new Set<string>();
    for (const k of c.keys) {
      if (!k.public_key_pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw Error("SAS_PUBLIC_KEY_REQUIRED");
      const key = createPublicKey(k.public_key_pem), bytes = material(key);
      if (materials.has(bytes)) throw Error("SAS_KEY_ALIAS_REJECTED");
      materials.add(bytes);
      keys.set(k.key_id, { key, status: k.status, validFrom: k.valid_from, validUntil: k.valid_until });
    }
    assertAuthorizationTrustSeparated(keys, this.sessionKeys);
    return bundle;
  }

  private load(requireCurrent: boolean): SignedAuthorizationTrustCandidate|SignedAuthorizationTrust|null {
    const state=this.state();return state?this.check(state.bundle,requireCurrent,state.transitions):null;
  }

  install(input: unknown): number {
    const state=this.state(),transitions=state?.transitions??[];
    const next = this.check(input, true,transitions), old = state?this.check(state.bundle,false,transitions):null;
    this.advance(next,old);
    if(old?.claims.generation===next.claims.generation)return old.claims.generation;
    // One protected envelope carries signature, generation, root chain and tombstones.
    this.write(next,transitions);return next.claims.generation;
  }
  private advance(next:SignedAuthorizationTrustCandidate|SignedAuthorizationTrust,old:SignedAuthorizationTrustCandidate|SignedAuthorizationTrust|null){
    if (old) {
      if (next.claims.generation < old.claims.generation) throw Error("SAS_GENERATION_ROLLBACK");
      if (next.claims.generation === old.claims.generation) {
        if (canonicalSessionTrustJson(next.claims) !== canonicalSessionTrustJson(old.claims)) throw Error("SAS_GENERATION_CONFLICT");
        return;
      }
      if (Date.parse(next.claims.issued_at) < Date.parse(old.claims.issued_at)) throw Error("SAS_ISSUANCE_ROLLBACK");
      for (const previous of old.claims.keys) {
        const replacement = next.claims.keys.find(k => k.key_id === previous.key_id);
        if (!replacement || material(createPublicKey(replacement.public_key_pem)) !== material(createPublicKey(previous.public_key_pem)) ||
          replacement.version < previous.version || rank[replacement.status] < rank[previous.status] ||
          (previous.status === "REVOKED" && canonicalSessionTrustJson(replacement) !== canonicalSessionTrustJson(previous)) ||
          (replacement.version === previous.version && canonicalSessionTrustJson(replacement) !== canonicalSessionTrustJson(previous)))
          throw Error("SAS_KEY_HISTORY_REJECTED");
      }
    }
  }
  /** Privileged single-writer operation. The old bootstrap root stays pinned;
   * restart verifies the whole retained chain rather than trusting a new PEM. */
  installRootTransition(input:unknown,bundle:unknown):number{
    if(this.policy.mode!=="DEPLOYMENT")throw Error("SAS_DEPLOYMENT_ROOT_TRANSITION_REQUIRED");
    const state=this.state();if(!state)throw Error("SAS_EXISTING_TRUST_REQUIRED");
    const old=this.check(state.bundle,true,state.transitions),transition=SignedAuthorizationRootTransitionSchema.parse(input);
    const next=SignedAuthorizationTrustSchema.parse(bundle);
    const last=state.transitions.at(-1)?.transition;
    if(last&&canonicalSessionTrustJson(last)===canonicalSessionTrustJson(transition)&&canonicalSessionTrustJson(old)===canonicalSessionTrustJson(next))return old.claims.generation;
    if(transition.claims.next_minimum_generation<=old.claims.generation)throw Error("SAS_ROOT_TRANSITION_FLOOR_REQUIRED");
    const transitions=[...state.transitions,{transition,accepted_at:this.now().toISOString()}];
    const checked=this.check(next,true,transitions);this.advance(checked,old);
    this.write(checked,transitions);return checked.claims.generation;
  }

  resolve(): ReadonlyMap<string, TrustedSigningKey> {
    try {
      const bundle = this.load(true);
      return new Map(bundle?.claims.keys.map(k => [k.key_id, {
        key: createPublicKey(k.public_key_pem), status: k.status,
        validFrom: new Date(Math.max(Date.parse(k.valid_from), Date.parse(bundle.claims.valid_from))).toISOString(),
        validUntil: new Date(Math.min(Date.parse(k.valid_until), Date.parse(bundle.claims.valid_until))).toISOString(),
      }]) ?? []);
    } catch { return new Map(); } // Corrupt/expired/untrusted persistence grants nothing.
  }

  /** Revalidates persisted root signature and clock at EVERY map read. */
  liveKeys(): ReadonlyMap<string, TrustedSigningKey> {
    const owner = this;
    return {
      get size() { return owner.resolve().size; },
      get: id => owner.resolve().get(id), has: id => owner.resolve().has(id),
      entries: () => owner.resolve().entries(), keys: () => owner.resolve().keys(), values: () => owner.resolve().values(),
      [Symbol.iterator]: () => owner.resolve()[Symbol.iterator](),
      forEach(callback, thisArg) { owner.resolve().forEach((value, key) => callback.call(thisArg, value, key, this)); },
    };
  }
}

/** Compatibility wrapper: the laboratory constructor still accepts LAB only. */
export class AuthorizationTrustCandidateStore extends AuthorizationTrustStore{
  constructor(secrets:EncryptedFileSecretStore,policy:CandidatePolicy,sessionKeys:ReadonlyMap<string,TrustedSigningKey>,clock:TrustedClockGuard,now:()=>Date){
    if(policy.mode!=="ISOLATED_VALIDATION")throw Error("SAS_LAB_OS_BOUND_ROOT_POLICY_REQUIRED");
    super(secrets,policy,sessionKeys,clock,now);
  }
}
