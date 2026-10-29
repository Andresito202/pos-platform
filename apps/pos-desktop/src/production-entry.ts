import { randomUUID } from "node:crypto";
import {app} from "electron";
import { loadProductionDesktopProvisioning } from "@pos-platform/local-channel";
import { startPosDesktop } from "./start.js";

function main(): void {
  const provisioning = loadProductionDesktopProvisioning();

  startPosDesktop({
    ...(process.env.POS_WINDOWS_DESKTOP_COMMERCIAL_FILE?{commercialFile:process.env.POS_WINDOWS_DESKTOP_COMMERCIAL_FILE}:{}),
    endpoint: provisioning.endpoint,
    channelSecret: provisioning.channelSecret,
    protocolRange: { min: "1.0.0", max: "1.0.0" },
    handshake: {
      protocol_version: "1.0.0",
      message_type: "runtime.handshake",
      request_id: randomUUID(),
      correlation_id: randomUUID(),
      payload_schema_version: "1.0.0",
      payload: {
        desktop_version: "1.0.0",
        service_version: "1.0.0",
        protocol_min: "1.0.0",
        protocol_max: "1.0.0",
        installation_id: provisioning.installationId,
        device_id: provisioning.deviceId,
        schema_version: "5",
        service_state: "READY",
      },
    },
  }).catch(() => {
    // Fatal authentication/IPC startup errors must never leave an orphaned
    // renderer running or print URLs, private paths, channel keys or tokens.
    console.error("POS_DESKTOP_BOOTSTRAP_FAILED");
    provisioning.channelSecret.fill(0);
    process.exitCode = 1;
    app.quit();
  });
}

main();
