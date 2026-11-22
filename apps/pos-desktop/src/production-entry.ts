import { randomUUID } from "node:crypto";
import { loadProductionDesktopProvisioning, readWindowsScmProvision, connectWindowsScmClient } from "@pos-platform/local-channel";
import { startPosDesktop } from "./start.js";
import { bootstrap } from "./main.js";

function handshake(installationId: string, deviceId: string) {
  return {
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
        installation_id: installationId,
        device_id: deviceId,
        schema_version: "5",
        service_state: "READY",
      },
  };
}

async function main(): Promise<void> {
  const handoffFile = process.env.POS_WINDOWS_SCM_HANDOFF_FILE;
  if (handoffFile !== undefined) {
    // Read installer-owned identity/pins before touching per-user channel keys.
    // No fallback on rejected custody, attestation, signature or handshake.
    const provision = readWindowsScmProvision(handoffFile, "DESKTOP",
      process.env.POS_INSTALLATION_ID, process.env.POS_DEVICE_ID);
    const channel = await connectWindowsScmClient(provision,
      handshake(provision.handoff.installation_id, provision.handoff.device_id),
      { min: "1.0.0", max: "1.0.0" });
    try {
      await bootstrap(channel);
    } catch (error) {
      await channel.close();
      throw error;
    }
    return;
  }

  const provisioning = loadProductionDesktopProvisioning();
  try {
    await startPosDesktop({
      endpoint: provisioning.endpoint,
      channelSecret: provisioning.channelSecret,
      protocolRange: { min: "1.0.0", max: "1.0.0" },
      handshake: handshake(provisioning.installationId, provisioning.deviceId),
    });
  } finally {
    provisioning.channelSecret.fill(0);
  }
}

// Electron emits ready after evaluating its ESM entry. bootstrap waits for
// ready, so awaiting main at module scope would deadlock that lifecycle.
void main().catch((error: unknown) => {
  console.error("production desktop bootstrap failed", error);
  process.exitCode = 1;
});
