import { describe, expect, it } from "vitest";
import { isAbsolute } from "node:path";
import { parseServiceConfig } from "../src/config.js";
import {
  RECOVERY_DELAYS_SECONDS,
  REQUIRED_ENVIRONMENT,
  SERVICE_ACCOUNT,
  SERVICE_ID,
  buildServiceDescriptor,
} from "../src/windows-service-descriptor.js";

/**
 * El descriptor de WinSW.
 *
 * No se comprueba que el XML «tenga buena pinta»: se comprueba que el entorno
 * que declara **lo acepta `parseServiceConfig`**, que es quien lo rechazará en
 * el arranque real. Un descriptor sintácticamente impecable con una variable de
 * más produce un servicio que no arranca y un diagnóstico opaco.
 */

/**
 * `config.ts` exige que `POS_DATA_DIRECTORY` sea absoluta, y lo comprueba con
 * `isAbsolute` de `node:path`, que **depende de la plataforma**: `C:\ProgramData`
 * es absoluta en Windows y no lo es en POSIX. La ruta real de la instalación es
 * `%ProgramData%\CamachoPOS`; aquí se usa una absoluta del anfitrión para que
 * la prueba comprueba lo que importa —que el entorno declarado lo acepta el
 * servicio— en cualquier plataforma.
 *
 * Que la ruta de Windows pase esa validación **en Windows** es
 * `REQUIRES_LOCAL_VERIFICATION`.
 */
const WINDOWS_DATA_DIRECTORY = "C:\\ProgramData\\CamachoPOS";
const HOST_DATA_DIRECTORY = isAbsolute(WINDOWS_DATA_DIRECTORY)
  ? WINDOWS_DATA_DIRECTORY
  : "/var/lib/camacho-pos";

const VALUES: Record<string, string> = {
  POS_DATA_DIRECTORY: HOST_DATA_DIRECTORY,
  POS_INSTALLATION_ID: "018f0000-0000-7000-8000-0000000000a1",
  POS_DEVICE_ID: "018f0000-0000-7000-8000-0000000000a2",
  POS_SERVICE_VERSION: "1.0.0",
  POS_PROTOCOL_MIN: "1.0.0",
  POS_PROTOCOL_MAX: "1.0.0",
  POS_TENANT_ID: "018f0000-0000-7000-8000-0000000000b1",
  POS_COMPANY_ID: "018f0000-0000-7000-8000-0000000000b2",
  POS_BRANCH_ID: "018f0000-0000-7000-8000-0000000000b3",
};

const INSTALLATION = {
  nodeExecutable: "C:\\Program Files\\Camacho POS\\runtime\\node.exe",
  bundle: "C:\\Program Files\\Camacho POS\\app\\pos-local-service.mjs",
  workingDirectory: "C:\\Program Files\\Camacho POS\\app",
};

function descriptor(environment: Record<string, string> = VALUES): string {
  return buildServiceDescriptor({ ...INSTALLATION, environment });
}

/** Extrae el entorno del XML emitido, como lo leería WinSW. */
function environmentFromXml(xml: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const match of xml.matchAll(/<env name="([^"]+)" value="([^"]*)"\/>/g)) {
    environment[match[1]!] = match[2]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  }
  return environment;
}

describe("descriptor de servicio WinSW", () => {
  it("el entorno que declara lo acepta la configuración real del servicio", () => {
    const environment = environmentFromXml(descriptor());
    expect(() => parseServiceConfig(environment)).not.toThrow();
  });

  it("si falta una variable, el descriptor se niega a generarse", () => {
    const { POS_BRANCH_ID: _omitted, ...incomplete } = VALUES;
    expect(() => descriptor(incomplete)).toThrow(/POS_BRANCH_ID/);
  });

  it("una variable POS_ de más se rechaza al generar, no en el arranque", () => {
    expect(() => descriptor({ ...VALUES, POS_EXTRA: "1" })).toThrow(/unexpected environment/);
    // Y la razón por la que importa: el servicio también la rechazaría.
    expect(() => parseServiceConfig({ ...VALUES, POS_EXTRA: "1" })).toThrow();
  });

  it("corre bajo la cuenta virtual, no bajo LocalSystem ni un usuario", () => {
    const xml = descriptor();
    expect(xml).toContain(`<username>NT SERVICE\\${SERVICE_ID}</username>`);
    expect(SERVICE_ACCOUNT).toBe(`NT SERVICE\\${SERVICE_ID}`);
    expect(xml).not.toContain("LocalSystem");
    expect(xml).not.toContain("NT AUTHORITY");
  });

  it("no contiene credencial alguna: la cuenta virtual no tiene contraseña", () => {
    const xml = descriptor();
    expect(xml).not.toContain("<password>");
    expect(xml.toLowerCase()).not.toContain("password");
  });

  it("arranca solo, sin sesión iniciada", () => {
    expect(descriptor()).toContain("<startmode>Automatic</startmode>");
  });

  it("deja margen a la parada ordenada y señala al proceso Node", () => {
    const xml = descriptor();
    expect(xml).toContain("<stoptimeout>30 sec</stoptimeout>");
    expect(xml).toContain("<stopparentprocessfirst>false</stopparentprocessfirst>");
  });

  it("la recuperación replica el retroceso exponencial que el repositorio ya usa", () => {
    // `DEFAULT_RETRY_POLICY` del outbox: 5 intentos, 1 s base, 60 s de tope.
    expect(RECOVERY_DELAYS_SECONDS).toHaveLength(5);
    expect(RECOVERY_DELAYS_SECONDS[0]).toBe(1);
    expect(RECOVERY_DELAYS_SECONDS.at(-1)).toBe(60);
    for (const [index, delay] of RECOVERY_DELAYS_SECONDS.slice(0, -1).entries()) {
      expect(delay).toBe(2 ** index);
    }
    const xml = descriptor();
    for (const delay of RECOVERY_DELAYS_SECONDS) {
      expect(xml).toContain(`<onfailure action="restart" delay="${String(delay)} sec"/>`);
    }
    expect(xml).toContain("<resetfailure>1 hour</resetfailure>");
  });

  it("escapa los valores: una ruta con comillas no rompe el XML", () => {
    const xml = descriptor({ ...VALUES, POS_DATA_DIRECTORY: 'C:\\a"b&c' });
    expect(xml).toContain('value="C:\\a&quot;b&amp;c"');
    expect(environmentFromXml(xml)["POS_DATA_DIRECTORY"]).toBe('C:\\a"b&c');
  });

  it("declara exactamente las nueve variables que el servicio exige", () => {
    expect(Object.keys(environmentFromXml(descriptor())).sort())
      .toEqual([...REQUIRED_ENVIRONMENT].sort());
  });

  it("apunta a un runtime de la instalación, no del repositorio", () => {
    const xml = descriptor();
    expect(xml).toContain("<executable>C:\\Program Files\\Camacho POS\\runtime\\node.exe</executable>");
    expect(xml).not.toContain("tsx");
    expect(xml).not.toContain("pnpm");
  });
});
