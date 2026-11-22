import { SignedWindowsScmCheckpointSchema, WindowsScmPolicyTrustSchema, windowsScmCheckpointSigningBytes,
  type SignedWindowsScmCheckpoint } from "@pos-platform/contracts";

/** Central-only signing boundary. The provisioned signer may use KMS/HSM; no
 * private key or signer implementation is shipped to a product client. */
export interface ScmCheckpointSigner { sign(bytes: Buffer): Promise<Buffer>; }
export class ScmCheckpointIssuer {
  constructor(private readonly signer: ScmCheckpointSigner) {}
  async issue(input: unknown): Promise<SignedWindowsScmCheckpoint> {
    const checkpoint = WindowsScmPolicyTrustSchema.parse(input);
    const signature = await this.signer.sign(windowsScmCheckpointSigningBytes(checkpoint));
    if (!Buffer.isBuffer(signature) || signature.length !== 64) throw Error("SCM_CHECKPOINT_SIGNER_REJECTED");
    return SignedWindowsScmCheckpointSchema.parse({checkpoint, signature:signature.toString("base64url")});
  }
}
