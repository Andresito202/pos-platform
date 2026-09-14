import { rmSync, unlinkSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabaseComponent } from "../src/local-database-component.js";
import {
  DEVICE_IDENTITY_SECRET,
  InsecureDerivedKeyProvider,
  LocalSecurityComponent,
  deviceIdentityContext,
  type SecretStoreKeyProvider,
} from "../src/security/index.js";

/**
 * El componente de arranque de seguridad (`DEC-020`) contra SQLite real.
 *
 * No hay dobles: se abre la base de datos de produccion, se deriva la clave
 * raiz, se cifra la identidad con AES-256-GCM y se leen las filas que quedan
 * escritas. Lo unico que no es de produccion es el proveedor de clave raiz,
 * porque DPAPI no existe en POSIX; ese camino lo cubre `process.test.ts` sobre
 * Windows real.
 */

const directories: string[] = [];

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-security-"));
  directories.push(value);
  return value;
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const BINDING = {
  installationId: "018f0000-0000-7000-8000-0000000000c1",
  deviceId: "018f0000-0000-7000-8000-0000000000c2",
} as const;

interface BootResult {
  readonly deviceKeyId: string;
  readonly identityRows: readonly unknown[];
  readonly keyHistory: readonly Record<string, unknown>[];
  readonly audit: readonly Record<string, unknown>[];
}

/**
 * Arranca base de datos + seguridad, observa el estado persistido y cierra.
 *
 * Se cierra siempre: `LocalDatabase.open` toma un cerrojo de escritor
 * exclusivo, de modo que dejar una abierta impediria el arranque siguiente.
 */
async function boot(
  dataDirectory: string,
  now: () => Date = () => new Date(),
  keyProvider?: SecretStoreKeyProvider,
): Promise<BootResult> {
  const securityDirectory = join(dataDirectory, "security");
  const database = new LocalDatabaseComponent(dataDirectory);
  const security = new LocalSecurityComponent(
    database,
    BINDING,
    keyProvider ?? new InsecureDerivedKeyProvider(securityDirectory),
    securityDirectory,
    now,
  );
  await database.start();
  try {
    await security.start();
    const native = database.database.native;
    return {
      deviceKeyId: security.deviceKeyId,
      identityRows: native.prepare("SELECT * FROM local_device_identity_state").all(),
      keyHistory: native
        .prepare("SELECT device_key_id,generation,secret_name,status,retired_at FROM local_device_key_history ORDER BY generation")
        .all() as Record<string, unknown>[],
      audit: native
        .prepare("SELECT sequence,event_type,subject_id FROM local_security_audit ORDER BY sequence")
        .all() as Record<string, unknown>[],
    };
  } finally {
    await security.stop();
    await database.stop();
  }
}

describe("arranque de seguridad local (DEC-020)", () => {
  it("materializa la identidad del dispositivo en el primer arranque", async () => {
    const dataDirectory = await directory();
    const result = await boot(dataDirectory);

    expect(result.deviceKeyId).toMatch(/^DEVICE_KEY_[0-9A-F]{64}$/);
    expect(result.identityRows).toHaveLength(1);
    expect(result.identityRows[0]).toMatchObject({
      singleton: 1,
      active_key_id: result.deviceKeyId,
      generation: 1,
      status: "ACTIVE",
    });
    expect(result.keyHistory).toHaveLength(1);
    expect(result.keyHistory[0]).toMatchObject({
      device_key_id: result.deviceKeyId,
      generation: 1,
      secret_name: DEVICE_IDENTITY_SECRET,
      status: "ACTIVE",
      retired_at: null,
    });
    // La auditoria append-only deja de ser una tabla vacia.
    expect(result.audit).toEqual([
      { sequence: 1, event_type: "DEVICE_KEY_REGISTERED", subject_id: result.deviceKeyId },
    ]);
  });

  it("recupera la misma identidad tras reiniciar y no duplica el asiento", async () => {
    const dataDirectory = await directory();
    const first = await boot(dataDirectory);
    const second = await boot(dataDirectory);

    // La clave privada sobrevivio al reinicio: se descifro el mismo secreto.
    expect(second.deviceKeyId).toBe(first.deviceKeyId);
    expect(second.keyHistory).toHaveLength(1);
    // El registro es idempotente: un segundo arranque no es un evento de
    // seguridad y no debe ensuciar la auditoria.
    expect(second.audit).toHaveLength(1);
  });

  it("detiene el arranque si el secreto protegido ya no produce la clave registrada", async () => {
    const dataDirectory = await directory();
    const first = await boot(dataDirectory);

    // El almacen de secretos se pierde y la base de datos sobrevive: el
    // arranque siguiente generaria una identidad nueva.
    unlinkSync(join(dataDirectory, "security", `${DEVICE_IDENTITY_SECRET}.secret`));

    await expect(boot(dataDirectory)).rejects.toThrow(
      /device identity registration refused/,
    );
    expect(first.deviceKeyId).toMatch(/^DEVICE_KEY_/);

    // Y lo que ya estaba registrado no se toco.
    const afterwards = await bootWithRestoredSecret(dataDirectory, first.deviceKeyId);
    expect(afterwards).toBe(1);
  });

  it("detiene el arranque si el sobre del secreto no autentica bajo esta instalacion", async () => {
    const dataDirectory = await directory();
    await boot(dataDirectory);

    // Mismo fichero de secreto, distinta clave raiz: es lo que ocurre cuando el
    // secreto viene de otra instalacion o de otro perfil de Windows.
    const securityDirectory = join(dataDirectory, "security");
    const foreign: SecretStoreKeyProvider = {
      protection: "TEST_ONLY",
      loadKey: () => Buffer.alloc(32, 0x5a),
    };

    await expect(boot(dataDirectory, () => new Date(), foreign)).rejects.toThrow(
      /device identity secret could not be opened/,
    );
  });

  it("rechaza un reloj retrocedido mas alla de la tolerancia", async () => {
    const dataDirectory = await directory();
    const reference = new Date("2026-09-14T12:00:00.000Z");
    await boot(dataDirectory, () => reference);

    const rolledBack = new Date(reference.getTime() - 3_600_000);
    await expect(boot(dataDirectory, () => rolledBack)).rejects.toThrow(
      /local clock rollback rejected/,
    );
  });

  it("propaga la proteccion del proveedor de clave sin interpretarla", async () => {
    const dataDirectory = await directory();
    const securityDirectory = join(dataDirectory, "security");
    const database = new LocalDatabaseComponent(dataDirectory);
    const security = new LocalSecurityComponent(
      database,
      BINDING,
      new InsecureDerivedKeyProvider(securityDirectory),
      securityDirectory,
    );
    expect(security.protection).toBe("TEST_ONLY");
    // Antes de arrancar no hay identidad que entregar, y se dice en vez de
    // devolver undefined.
    expect(() => security.deviceKeyId).toThrow(/device identity is not ready/);
    expect(() => security.secretStore).toThrow(/secret store is not ready/);
  });

  it("liga el contexto criptografico a la instalacion y al dispositivo", () => {
    const context = deviceIdentityContext(BINDING);
    expect(context).toContain(BINDING.installationId);
    expect(context).toContain(BINDING.deviceId);
    expect(deviceIdentityContext({ ...BINDING, deviceId: "otro" })).not.toBe(context);
  });
});

describe("InsecureDerivedKeyProvider", () => {
  it("se niega a construirse fuera de NODE_ENV=test", () => {
    expect(() => new InsecureDerivedKeyProvider("/tmp/pos", { NODE_ENV: "production" }))
      .toThrow(/refused outside NODE_ENV=test/);
  });

  it("se niega a entregar clave aunque el entorno cambie despues de construirse", () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    const provider = new InsecureDerivedKeyProvider("/tmp/pos", environment);
    environment["NODE_ENV"] = "production";
    expect(() => provider.loadKey("cualquiera")).toThrow(/refused outside NODE_ENV=test/);
  });

  it("exige ruta absoluta y contexto", () => {
    expect(() => new InsecureDerivedKeyProvider("relativo", { NODE_ENV: "test" }))
      .toThrow(/must be absolute/);
    const provider = new InsecureDerivedKeyProvider("/tmp/pos", { NODE_ENV: "test" });
    expect(() => provider.loadKey("")).toThrow(/context is required/);
  });

  it("deriva 32 bytes estables, y distintos para directorio o contexto distintos", () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    const a = new InsecureDerivedKeyProvider("/tmp/pos-a", environment);
    const b = new InsecureDerivedKeyProvider("/tmp/pos-b", environment);
    expect(a.loadKey("ctx").byteLength).toBe(32);
    expect(a.loadKey("ctx").equals(a.loadKey("ctx"))).toBe(true);
    expect(a.loadKey("ctx").equals(b.loadKey("ctx"))).toBe(false);
    expect(a.loadKey("ctx").equals(a.loadKey("otro"))).toBe(false);
  });
});

/**
 * Cuenta las filas del libro de claves reabriendo la base de datos sola. Sirve
 * para comprobar que un arranque rechazado no escribio nada.
 */
async function bootWithRestoredSecret(dataDirectory: string, expectedKeyId: string): Promise<number> {
  const database = new LocalDatabaseComponent(dataDirectory);
  await database.start();
  try {
    const rows = database.database.native
      .prepare("SELECT device_key_id FROM local_device_key_history")
      .all() as { device_key_id: string }[];
    expect(rows.map((row) => row.device_key_id)).toEqual([expectedKeyId]);
    return rows.length;
  } finally {
    await database.stop();
  }
}
