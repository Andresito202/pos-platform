/**
 * Tokens de inyección explícitos: `esbuild` (usado por `tsx` y `vitest`) no
 * emite `emitDecoratorMetadata`, así que la inyección por tipo de parámetro
 * de NestJS no funciona fuera de `tsc` (ver `app.ts`).
 */
export const PG_POOL = Symbol("PG_POOL");
export const DEVICE_LOGIN_VERIFICATION = Symbol("DEVICE_LOGIN_VERIFICATION");
export const TENANT_LOGIN_SERVICE = Symbol("TENANT_LOGIN_SERVICE");
export const MFA_ENROLLMENT_SERVICE = Symbol("MFA_ENROLLMENT_SERVICE");
