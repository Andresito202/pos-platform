import { describe, expect, it } from "vitest";
import { LocalOperatorSessionRegistry } from "./local-operator-session-registry.js";

const operator = { username: "admin.local", role: "ADMINISTRADOR" } as const;
const accepted = { status: "AUTHENTICATED", operator } as const;

describe("connection-scoped local operator sessions", () => {
  it("authenticates by backend gate, binds to only one channel, and expires", async () => {
    let now = Date.parse("2026-11-08T12:00:00.000Z");
    const registry = new LocalOperatorSessionRegistry({
      authenticate: async (user, password) =>
        user === operator.username && password === "correct" ? accepted : {status:"DENIED"},
    }, () => now);
    expect(await registry.login("channel-A","admin.local","wrong")).toEqual({status:"DENIED"});
    expect(registry.resolve("channel-A")).toBeNull();
    const logged = await registry.login("channel-A","admin.local","correct");
    expect(logged.status).toBe("AUTHENTICATED");
    expect(registry.resolve("channel-A")?.role).toBe("ADMINISTRADOR");
    expect(registry.resolve("channel-B")).toBeNull();
    now += 8 * 60 * 60 * 1000;
    expect(registry.resolve("channel-A")).toBeNull();
  });

  it("revokes old identity before attempting a different user", async () => {
    const registry = new LocalOperatorSessionRegistry({
      authenticate: async (_user,password) =>
        password === "correct" ? accepted : {status:"DENIED"},
    });
    await registry.login("A","admin.local","correct");
    expect(registry.resolve("A")).not.toBeNull();
    expect(await registry.login("A","cajero.local","wrong")).toEqual({status:"DENIED"});
    expect(registry.resolve("A")).toBeNull();
    await registry.login("A","admin.local","correct");
    registry.logout("A");
    expect(registry.resolve("A")).toBeNull();
  });

  it("discards login completed after channel disconnection", async () => {
    let release: ((result: typeof accepted) => void) | undefined;
    const registry = new LocalOperatorSessionRegistry({
      authenticate: () => new Promise<typeof accepted>((resolve) => { release=resolve; }),
    });
    const pending=registry.login("A","admin.local","correct");
    expect(registry.resolve("A")).toBeNull();
    registry.release("A");
    release!(accepted);
    expect(await pending).toEqual({status:"DENIED"});
    expect(registry.resolve("A")).toBeNull();
  });

  it("does not revive a disconnected login after its connection ID is reused",async()=>{
    const releases: Array<(result:typeof accepted)=>void> = [];
    const registry=new LocalOperatorSessionRegistry({
      authenticate:()=>new Promise<typeof accepted>(resolve=>{releases.push(resolve);}),
    });
    const old=registry.login("A","admin.local","correct");
    registry.release("A");
    const next=registry.login("A","admin.local","correct");
    releases[0]!(accepted);
    expect(await old).toEqual({status:"DENIED"});
    expect(registry.resolve("A")).toBeNull();
    releases[1]!(accepted);
    expect((await next).status).toBe("AUTHENTICATED");
    expect(registry.resolve("A")?.username).toBe("admin.local");
  });

  it("denies overlapping authentication and does not revive cleared sessions",async()=>{
    let release:((result:typeof accepted)=>void)|undefined;
    const registry=new LocalOperatorSessionRegistry({
      authenticate:()=>new Promise<typeof accepted>((resolve)=>{release=resolve;}),
    });
    const first=registry.login("A","admin.local","correct");
    expect(await registry.login("A","admin.local","correct")).toEqual({status:"DENIED"});
    registry.clear();
    release!(accepted);
    expect(await first).toEqual({status:"DENIED"});
    expect(registry.resolve("A")).toBeNull();
  });
});
