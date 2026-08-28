import type { RuntimeState } from "./lifecycle.js";
export interface RuntimeHealth {
  readonly state: RuntimeState;
  readonly ready: boolean;
  readonly service_version: string;
  readonly protocol_min: string;
  readonly protocol_max: string;
}
export function runtimeHealth(state: RuntimeState, serviceVersion: string, protocolMin: string, protocolMax: string): RuntimeHealth {
  return { state, ready: state === "READY", service_version: serviceVersion, protocol_min: protocolMin, protocol_max: protocolMax };
}
