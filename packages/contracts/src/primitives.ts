import * as z from "zod";

const CONTRACT_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MESSAGE_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*(?:[.:-][A-Z0-9_]+)*$/;
const MESSAGE_KEY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]+$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const UuidSchema = z.uuid().transform((value) => value.toLowerCase());
export const UuidV7Schema = UuidSchema.refine((value) => value[14] === "7", {
  message: "UUID must use version 7",
});

export function uuidV7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const ContractVersionSchema = z.string().max(32).regex(CONTRACT_VERSION_PATTERN);
export const MessageTypeSchema = z.string().min(1).max(128).regex(MESSAGE_TYPE_PATTERN);
export const StableCodeSchema = z.string().min(1).max(96).regex(STABLE_CODE_PATTERN);
export const MessageKeySchema = z.string().min(1).max(160).regex(MESSAGE_KEY_PATTERN);
export const IdempotencyKeySchema = z.string().min(1).max(200).regex(IDEMPOTENCY_KEY_PATTERN);
export const Sha256HexSchema = z.string().length(64).regex(SHA256_HEX_PATTERN);
export const VersionIdentifierSchema = z.string().min(1).max(64).regex(VERSION_IDENTIFIER_PATTERN);
export const ExpectedVersionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const UtcDateTimeSchema = z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);

export type ContractVersion = z.infer<typeof ContractVersionSchema>;
export type StableCode = z.infer<typeof StableCodeSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
