import { describe, expect, it } from "vitest";
import { Ch340ScaleReader } from "../src/hardware/ch340-scale-reader.js";

function fixture() {
  let now = 0;
  const reader = new Ch340ScaleReader(() => now);
  reader.reconnect();
  const send = (frame: string, advance = 200) => { now += advance; reader.feed(Buffer.from(frame)); };
  const stable = (weight: string) => { for (let i = 0; i < 5; i++) send(weight + "\r\n"); };
  return { reader, send, stable, advance: (ms: number) => { now += ms; } };
}
describe("CH340 external bench protocol", () => {
  it("requires stable zero then fresh positive samples and consumes once", () => {
    const { reader, stable } = fixture();
    stable("000.265"); expect(reader.consume()).toBeNull();
    stable("000.000"); stable("000.265");
    expect(reader.consume()).toMatchObject({ grams: 265, kg: "0.265" });
    expect(reader.consume()).toBeNull();
    stable("000.265"); expect(reader.consume()).toBeNull();
    stable("000.000"); stable("000.455");
    expect(reader.consume()).toMatchObject({ grams: 455, kg: "0.455" });
  });
  it("reconstructs split CRLF frames", () => {
    const { reader, send, stable } = fixture();
    stable("000.000");
    for(let i=0;i<5;i++){send("000.",200);send("265\r",0);send("\n",0);}
    expect(reader.consume()?.grams).toBe(265);
  });
  it.each(["-00.265","000.266","040.005","000.095","000.265kg","x000.265","000.265\r\r"])("rejects invalid reading %s and rearms only at zero", (invalid) => {
    const { reader, send, stable } = fixture(); stable("000.000");
    send(invalid + "\r\n"); stable("000.265"); expect(reader.consume()).toBeNull();
    stable("000.000"); stable("000.265"); expect(reader.consume()?.grams).toBe(265);
  });
  it("does not treat a burst as a stable sample window", () => {
    const { reader, send, stable } = fixture();
    stable("000.000"); send("000.265\r\n".repeat(20));
    expect(reader.consume()).toBeNull();
  });
  it("expires stale measurements", () => {
    const { reader, stable, advance } = fixture();
    stable("000.000"); stable("000.265"); advance(2001);
    expect(reader.consume()).toBeNull(); expect(reader.status()).toBe("stale");
  });
  it("does not preserve an unconsumed weight after removal", () => {
    const { reader, stable, send } = fixture(); stable("000.000"); stable("000.265");
    send("000.000\r\n"); expect(reader.consume()).toBeNull();
  });
  it("clears prior events on disconnect and rotates the session on reconnect", () => {
    const { reader, stable } = fixture(); stable("000.000"); stable("000.265");
    const first = reader.consume(); expect(first).not.toBeNull();
    reader.disconnect(); expect(reader.status()).toBe("disconnected");
    reader.reconnect(); stable("000.265"); expect(reader.consume()).toBeNull();
    stable("000.000"); stable("000.265");
    const second = reader.consume(); expect(second).not.toBeNull();
    expect(second?.session).not.toBe(first?.session);
  });
  it("rejects oversized input without retaining a previous measurement", () => {
    const { reader, stable, send } = fixture(); stable("000.000"); stable("000.265");
    send("x".repeat(4097)); expect(reader.consume()).toBeNull();
  });
});
