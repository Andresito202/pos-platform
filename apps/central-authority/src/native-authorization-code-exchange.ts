import { timingSafeEqual } from "node:crypto";
import { matchesPkceS256Challenge, validateNativeClientRegistration, type NativeClientRegistration } from "./native-authorization-constraints.js";

/** Trusted server-originated record. Must never be assembled from callback parameters. */
export interface StoredNativeAuthorizationGrant {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string;
}

/**
 * Approved database owner must atomically lock, authenticate, consume and
 * commit one code within a transaction. Invalid verification MUST consume the
 * code too, to avoid online guessing of the verifier. Until the canonical
 * owner implements this interface, no exchange is possible.
 */
export interface AtomicNativeCodeConsumer<Binding> {
  readonly durabilityPolicyReference: string;
  consume(
    code: string,
    verify: (record: StoredNativeAuthorizationGrant) => boolean,
  ): Promise<Binding | null>;
}

function eq(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8"), right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class NativeAuthorizationCodeExchange<Binding> {
  constructor(
    private readonly registration: NativeClientRegistration,
    private readonly consumer: AtomicNativeCodeConsumer<Binding>,
  ) {
    validateNativeClientRegistration(registration);
    if (!consumer?.durabilityPolicyReference?.trim() || typeof consumer.consume !== "function")
      throw new Error("NATIVE_DURABLE_CODE_CONSUMER_REQUIRED");
  }

  /** A trusted, opaque binding only; NEVER a JWT, refresh token or SSA. */
  async exchange(input: { readonly code: string; readonly verifier: string; readonly state: string }): Promise<Binding | null> {
    if (!input || typeof input.code !== "string" ||
        !/^[A-Za-z0-9._~-]{16,512}$/.test(input.code) ||
        typeof input.state !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(input.state))
      return null;
    return this.consumer.consume(input.code, record =>
      record.clientId === this.registration.clientId &&
      record.redirectUri === this.registration.redirectUri &&
      typeof record.state === "string" && eq(record.state, input.state) &&
      matchesPkceS256Challenge(input.verifier, record.codeChallenge)
    );
  }
}
