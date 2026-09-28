import { describe, expect, it } from "vitest";
import { parseLabProvisioning } from "../src/lab-provisioning.js";

const VALID = {
  kind: "LAB",
  created_at: "2026-09-27T16:00:00.0000000Z",
  installation_id: "af0a199a-6d98-4966-b729-bbfe91a97a5e",
  device_id: "9ff5b76a-be3d-4433-903a-a4c323ba3107",
  tenant_id: "00000000-0000-7000-8000-0000000000d1",
  company_id: "2e7696f3-1831-403c-a9a4-d683eec298e7",
  branch_id: "69832fae-64e2-4ad9-917f-554fed568f31",
  data_directory: "C:\\Proyectos\\pos-platform\\apps\\pos-local-service\\dist\\staging\\data",
  service_account: "ANDRESITOCAMACHO\\Usuario",
};

describe("provisioning.json de laboratorio → entorno de la ventana de producción", () => {
  it("entrega exactamente las tres variables que exige loadProductionDesktopProvisioning", () => {
    expect(parseLabProvisioning(JSON.stringify(VALID))).toEqual({
      POS_DATA_DIRECTORY: VALID.data_directory,
      POS_INSTALLATION_ID: VALID.installation_id,
      POS_DEVICE_ID: VALID.device_id,
    });
  });

  it("acepta el BOM que Windows PowerShell 5.1 antepone al escribir UTF-8", () => {
    expect(parseLabProvisioning(`\uFEFF${JSON.stringify(VALID)}`).POS_INSTALLATION_ID).toBe(VALID.installation_id);
  });

  it("rechaza lo que el servicio rechazaría, en vez de fallar después en el handshake", () => {
    expect(() => parseLabProvisioning(JSON.stringify({ ...VALID, kind: "PRODUCTION" }))).toThrow();
    // La named pipe se nombra en minúsculas: una mayúscula daría otra tubería.
    expect(() => parseLabProvisioning(JSON.stringify({ ...VALID, installation_id: VALID.installation_id.toUpperCase() }))).toThrow();
    expect(() => parseLabProvisioning(JSON.stringify({ ...VALID, data_directory: "staging\\data" }))).toThrow();
    expect(() => parseLabProvisioning(JSON.stringify({ ...VALID, device_id: "no-es-uuid" }))).toThrow();
  });

  it("con login central declarado, la ventana exige iniciar sesión; sin él, no", () => {
    expect(parseLabProvisioning(JSON.stringify({ ...VALID, central_login: true })).POS_DESKTOP_REQUIRE_LOGIN).toBe("1");
    expect(parseLabProvisioning(JSON.stringify({ ...VALID, central_login: false })).POS_DESKTOP_REQUIRE_LOGIN).toBeUndefined();
    expect(parseLabProvisioning(JSON.stringify(VALID)).POS_DESKTOP_REQUIRE_LOGIN).toBeUndefined();
  });
});
