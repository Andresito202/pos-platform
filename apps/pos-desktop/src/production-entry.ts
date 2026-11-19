import { randomUUID } from "node:crypto";
import { loadProductionDesktopProvisioning } from "@pos-platform/local-channel";
import { startPosDesktop } from "./start.js";

function main(): void {
  const provisioning = loadProductionDesktopProvisioning();

  startPosDesktop({
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
  }).catch((error: unknown) => {
    console.error("production desktop bootstrap failed", error);
    provisioning.channelSecret.fill(0);
    process.exitCode = 1;
  });
}

main();
