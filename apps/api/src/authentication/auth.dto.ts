import * as z from "zod";
import { DeviceTrustProofSchema, SignedDeviceTrustCredentialSchema, UuidSchema } from "@pos-platform/contracts";

export const DeviceChallengeRequestSchema = z.strictObject({
  device_id: UuidSchema,
});

export const LoginRequestSchema = z.strictObject({
  device_credential: SignedDeviceTrustCredentialSchema,
  challenge_id: UuidSchema,
  proof: DeviceTrustProofSchema,
  login_name: z.string().min(1).max(256),
  /** Sin cota inferior propia: `evaluatePassword` (`A-5`) decide qué longitud vale para cada rol. */
  password: z.string().min(1).max(4096),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
