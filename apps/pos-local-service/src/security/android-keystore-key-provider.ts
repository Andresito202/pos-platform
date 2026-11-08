import { hkdfSync } from "node:crypto";
import type { SecretStoreKeyProvider } from "./encrypted-secret-store.js";

/** Privileged adapter: root bytes arrive only over the inherited native-parent pipe.
 * This does not authenticate a person/device or approve an Android production profile.
 */
export class AndroidKeystoreKeyProvider implements SecretStoreKeyProvider {
  readonly protection="OS_BOUND" as const;
  private readonly root:Buffer;
  private destroyed=false;
  constructor(nativeRoot:Buffer,platform:NodeJS.Platform=process.platform) {
    if(platform!=="android")throw new Error("ANDROID_KEYSTORE_HOST_REQUIRED");
    if(nativeRoot.length!==32)throw new Error("ANDROID_KEYSTORE_ROOT_SIZE_REJECTED");
    this.root=Buffer.from(nativeRoot);
  }
  loadKey(context:string):Buffer {
    if(this.destroyed)throw new Error("ANDROID_KEYSTORE_PROVIDER_DESTROYED");
    if(!context||Buffer.byteLength(context,"utf8")>1024)throw new Error("ANDROID_KEYSTORE_CONTEXT_REJECTED");
    return Buffer.from(hkdfSync("sha256",this.root,Buffer.from("camacho.android.keystore-root.v1"),Buffer.from(context),32));
  }
  destroy():void { this.root.fill(0);this.destroyed=true; }
}
