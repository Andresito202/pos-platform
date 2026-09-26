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
  /** Sólo lo exigen los roles de administración (`A-4`); el resto lo ignora. */
  totp_code: z.string().regex(/^\d{6}$/).nullish(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Enrolamiento de MFA: reautentica con usuario y contraseña, igual de
 * estricto que el login (`mfa-enrollment-service.ts` explica por qué no
 * exige una sesión previa). Sin prueba de equipo: un administrador enrola su
 * segundo factor desde un navegador, no desde el POS físico, así que no hay
 * equipo del que derivar el comercio.
 *
 * **`tenant_id` sí lo declara aquí el cliente, a diferencia del login.** No
 * es una excepción al principio: sólo acota una búsqueda, nunca autoriza
 * nada por sí solo. Un `tenant_id` ajeno, con o sin `login_name` real en él,
 * termina exactamente en el mismo `REJECTED` que una contraseña equivocada
 * —`user_login_names` está particionado por comercio, así que un
 * `login_name` real de OTRO comercio simplemente no aparece—. La puerta de
 * seguridad sigue siendo la contraseña, y el secreto que este endpoint
 * entrega no sirve de nada hasta confirmarlo con un código que sólo puede
 * generar quien ya lo vio.
 */
export const MfaEnrollmentRequestSchema = z.strictObject({
  tenant_id: UuidSchema,
  login_name: z.string().min(1).max(256),
  password: z.string().min(1).max(4096),
});

export const MfaConfirmRequestSchema = z.strictObject({
  tenant_id: UuidSchema,
  login_name: z.string().min(1).max(256),
  password: z.string().min(1).max(4096),
  factor_id: UuidSchema,
  code: z.string().regex(/^\d{6}$/),
});
