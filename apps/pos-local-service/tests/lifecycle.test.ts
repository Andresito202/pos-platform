import { describe, expect, it } from "vitest";
import { ServiceLifecycle, runtimeHealth, type RuntimeComponent } from "../src/index.js";

function component(name: string, events: string[], fail = false): RuntimeComponent {
  return {
    name,
    start: async () => { events.push(`start:${name}`); if (fail) throw new Error(name); },
    stop: async () => { events.push(`stop:${name}`); },
  };
}

describe("ServiceLifecycle", () => {
  it("starts in order and stops in reverse", async () => {
    const events: string[] = [];
    const runtime = new ServiceLifecycle([component("a", events), component("b", events)]);
    await runtime.start();
    expect(runtimeHealth(runtime.state, "1.0.0", "1.0.0", "1.0.0").ready).toBe(true);
    await runtime.stop();
    expect(events).toEqual(["start:a", "start:b", "stop:b", "stop:a"]);
  });

  it("rolls back already started components", async () => {
    const events: string[] = [];
    const runtime = new ServiceLifecycle([component("a", events), component("b", events, true)]);
    await expect(runtime.start()).rejects.toThrow("runtime start failed");
    expect(events).toEqual(["start:a", "start:b", "stop:a"]);
    expect(runtime.state).toBe("FAILED");
  });

  it("returns one stop operation to concurrent callers", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: RuntimeComponent = {
      name: "slow",
      start: async () => { events.push("start:slow"); },
      stop: async () => { events.push("stop:slow"); await gate; },
    };
    const runtime = new ServiceLifecycle([slow], 1_000);
    await runtime.start();
    const first = runtime.stop();
    const second = runtime.stop();
    expect(first).toBe(second);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["start:slow", "stop:slow"]);
    expect(runtime.state).toBe("STOPPED");
  });

  it("fails bounded shutdown when a component does not stop", async () => {
    const stuck: RuntimeComponent = {
      name: "stuck",
      start: async () => undefined,
      stop: async () => new Promise<void>(() => undefined),
    };
    const runtime = new ServiceLifecycle([stuck], 20);
    await runtime.start();
    await expect(runtime.stop()).rejects.toThrow("runtime stop failed");
    expect(runtime.state).toBe("FAILED");
  });

  it("rejects duplicate component identities", () => {
    const events: string[] = [];
    expect(() => new ServiceLifecycle([component("a", events), component("a", events)])).toThrow();
  });
});
