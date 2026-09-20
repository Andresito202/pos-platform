import { randomBytes } from "node:crypto";

/**
 * Frontera mínima con PostgreSQL, sin driver.
 *
 * El paquete define el puerto y **no** importa `pg`: quien lo use aporta el
 * cliente. Así el plano central no queda atado a un driver concreto, igual
 * que `PaymentProviderPort` no ata Payments a un PSP.
 */
export interface SqlQueryExecutor {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly R[]>;
}

/**
 * Quien sabe abrir una transacción.
 *
 * `UC-ONB-001` §374 exige **una sola transacción central** para el bootstrap
 * completo, de modo que la frontera transaccional pertenece al puerto y no al
 * llamador: un caso de uso que recibiera un ejecutor suelto no podría
 * garantizar el rollback que el contrato exige.
 */
export interface TransactionalSql {
  withTransaction<T>(run: (tx: SqlQueryExecutor) => Promise<T>): Promise<T>;
}

/**
 * UUID versión 7, que es lo que el esquema central exige.
 *
 * `platform.is_uuid_v7` gobierna la clave primaria de casi toda tabla de
 * `001_central_foundation`, así que un `randomUUID()` —versión 4— sería
 * rechazado por un `CHECK` en la primera inserción. Se genera aquí, sin
 * dependencia nueva: 48 bits de milisegundos big-endian, versión 7, variante
 * RFC 4122 y 74 bits aleatorios.
 */
export function uuidV7(at: Date = new Date()): string {
  const bytes = randomBytes(16);
  const millis = BigInt(at.getTime());
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((millis >> BigInt(8 * (5 - index))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join("-");
}
