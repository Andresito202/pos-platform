export type IdentityDomainErrorCode = "ASSIGNMENT_OUTSIDE_MEMBERSHIP_TENANT";

export class IdentityDomainError extends Error {
  constructor(readonly code: IdentityDomainErrorCode, message: string) {
    super(message);
    this.name = "IdentityDomainError";
  }
}
