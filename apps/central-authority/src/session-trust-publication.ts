import { lstatSync,readFileSync } from "node:fs";
import {isAbsolute} from "node:path";
import { SessionAssertionTrustBundleSchema,AuthorizationTrustDeliverySchema, type SessionAssertionTrustBundle } from "@pos-platform/contracts";

/**
 * Publishes an already root-signed SESSION_ASSERTION trust bundle.
 *
 * Central Authority never creates the root trust decision here. The bundle is
 * signed offline/by the product trust root and this component only validates
 * its public contract before serving it.
 */
export class SessionTrustPublication {
  constructor(private readonly artifactPath: string) {}

  load(): SessionAssertionTrustBundle {
    return SessionAssertionTrustBundleSchema.parse(
      JSON.parse(readFileSync(this.artifactPath, "utf8")),
    );
  }
}

/** Public signed material only. Signature, recipient and chain are verified
 * by Service against its independently installed root, never by this reader. */
export class AuthorizationTrustPublication{
  constructor(private readonly artifactPath:string,private readonly scope?:Readonly<{issuer:string;environment?:"PREPRODUCTION"|"PRODUCTION"}>){
    if(!isAbsolute(artifactPath))throw Error("SAS_PUBLICATION_ABSOLUTE_FILE_REQUIRED");
    this.scope=scope?Object.freeze({...scope}):undefined;
  }
  load(){
    const stat=lstatSync(this.artifactPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error("SAS_PUBLICATION_FILE_REJECTED");
    const delivery=AuthorizationTrustDeliverySchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(this.artifactPath))));
    const claims="transition" in delivery?[delivery.bundle.claims,delivery.transition.claims]:[delivery.claims];
    if(this.scope&&claims.some(c=>c.issuer!==this.scope!.issuer||this.scope!.environment!==undefined&&c.environment!==this.scope!.environment))throw Error("SAS_PUBLICATION_SCOPE_REJECTED");
    return delivery;
  }
}
