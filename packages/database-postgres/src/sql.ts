import { randomBytes } from "node:crypto";

export interface SqlQueryExecutor {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<readonly R[]>;
}
export interface TransactionalSql {
  withTransaction<T>(run: (tx: SqlQueryExecutor) => Promise<T>): Promise<T>;
}
export function uuidV7(at: Date = new Date()): string {
  const bytes = randomBytes(16);
  const millis = BigInt(at.getTime());
  for (let index = 0; index < 6; index += 1) bytes[index] = Number((millis >> BigInt(8 * (5 - index))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}
