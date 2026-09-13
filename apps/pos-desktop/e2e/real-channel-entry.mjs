/**
 * Entrada de Electron para la verificación del **canal real**.
 *
 * A diferencia de `smoke-entry.mjs` —que inyecta un `ServiceChannel` de doble
 * para comprobar únicamente que la aplicación monta—, ésta arranca el POS por
 * el mismo camino que usará producción: `startPosDesktop()` construye el
 * `LocalChannelAuthenticator`, abre el socket con `LocalChannelClient` y
 * negocia el handshake contra un POS Local Service real.
 *
 * **Lo único que aporta el arnés es el secreto del canal.** En producción lo
 * resuelve la plataforma; aquí lo entrega el proceso que lanza la prueba, que
 * es el mismo que levanta el servicio al otro extremo del socket. Cliente,
 * socket, MAC, anti-replay, handler y SQLite son reales.
 *
 * No se auto-ejecuta con `await` en el nivel superior: eso deja colgado a
 * cualquier supervisor que espere a que el proceso señale su arranque.
 */
import { startPosDesktop } from "../dist/start.bundle.mjs";

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`missing ${name} for the real-channel entry`);
  }
  return value;
}

const endpoint = required("POS_E2E_CHANNEL_ENDPOINT");
const channelSecret = Buffer.from(required("POS_E2E_CHANNEL_SECRET"), "hex");
const installationId = required("POS_E2E_INSTALLATION_ID");
const deviceId = required("POS_E2E_DEVICE_ID");

if (channelSecret.byteLength !== 32) {
  throw new Error("the channel secret must be 32 bytes");
}

startPosDesktop({
  endpoint,
  channelSecret,
  protocolRange: { min: "1.0.0", max: "1.0.0" },
  handshake: {
    protocol_version: "1.0.0",
    message_type: "runtime.handshake",
    request_id: crypto.randomUUID(),
    correlation_id: crypto.randomUUID(),
    payload_schema_version: "1.0.0",
    payload: {
      desktop_version: "1.0.0",
      service_version: "1.0.0",
      protocol_min: "1.0.0",
      protocol_max: "1.0.0",
      installation_id: installationId,
      device_id: deviceId,
      schema_version: "5",
      service_state: "READY",
    },
  },
}).catch((error) => {
  console.error("real-channel entry failed", error);
  process.exit(1);
});
