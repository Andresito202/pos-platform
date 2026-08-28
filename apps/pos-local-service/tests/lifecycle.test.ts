import { describe, expect, it } from "vitest";
import { ServiceLifecycle, runtimeHealth, type RuntimeComponent } from "../src/index.js";

function component(name: string, events: string[], fail = false): RuntimeComponent {
  return { name, start: async () => { events.push(`start:${name}`); if (fail) throw new Error(name); }, stop: async () => { events.push(`stop:${name}`); } };
}
describe("ServiceLifecycle", () => {
  it("starts in order and stops in reverse", async () => {
    const events: string[] = []; const runtime = new ServiceLifecycle([component("a", events), component("b", events)]);
    await runtime.start(); expect(runtimeHealth(runtime.state, "1.0.0", "1.0.0", "1.0.0").ready).toBe(true);
    await runtime.stop(); expect(events).toEqual(["start:a", "start:b", "stop:b", "stop:a"]);
  });
  it("rolls back already started components", async () => {
    const events: string[] = []; const runtime = new ServiceLifecycle([component("a", events), component("b", events, true)]);
    await expect(runtime.start()).rejects.toThrow("runtime start failed");
    expect(events).toEqual(["start:a", "start:b", "stop:a"]); expect(runtime.state).toBe("FAILED");
  });
  it("rejects duplicate component identities", () => {
    const events: string[] = [];
    expect(() => new ServiceLifecycle([component("a", events), component("a", events)])).toThrow();
  });
});
