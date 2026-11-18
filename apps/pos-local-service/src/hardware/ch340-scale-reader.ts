import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

/** TEK ATLAS external bench parameters, PR #101. Not a metrological approval. */
const MIN_GRAMS = 100;
const MAX_GRAMS = 40_000;
const STEP_GRAMS = 5;
const SPREAD_GRAMS = 10;
const WINDOW_MS = 750;
const FRESH_MS = 2_000;
const MIN_SAMPLES = 5;
const MAX_FRAME = 9; // 000.455\r\n
const MAX_CHUNK = 4096;

export type ScaleMeasurement = Readonly<{
  session: string; eventId: string; grams: number; kg: string; ageMs: number;
}>;
export type ScaleState = "waiting_zero" | "waiting_weight" | "changing" | "ready" | "stale" | "invalid" | "disconnected";
type Sample = { grams: number; at: number };

/** Pure bounded serial-frame reader. A transport owned by the service supplies
 * bytes; renderer input must never call feed(). Weights use integer grams.
 * No weight is restored after a transport disconnect or a service restart.
 */
export class Ch340ScaleReader {
  private frame = "";
  private dropping = false;
  private samples: Sample[] = [];
  private armed = false;
  private connected = false;
  private session = randomUUID();
  private state: ScaleState = "disconnected";
  private event: { eventId: string; grams: number; at: number } | null = null;
  private lastSampleAt: number | null = null;
  private lastClock = -Infinity;
  constructor(private readonly clock: () => number = () => performance.now()) {}

  reconnect(): void {
    this.session = randomUUID();
    this.connected = true;
    this.frame = ""; this.dropping = false; this.samples = [];
    this.event = null; this.lastSampleAt = null; this.armed = false; this.lastClock = -Infinity;
    this.state = "waiting_zero";
  }
  disconnect(): void {
    this.connected = false; this.frame = ""; this.dropping = false;
    this.samples = []; this.event = null; this.lastSampleAt = null; this.armed = false;
    this.state = "disconnected";
  }
  private now(): number {
    const at = this.clock();
    if (!Number.isFinite(at) || at < this.lastClock) {
      this.disconnect();
      throw new Error("SCALE_CLOCK_INVALID");
    }
    this.lastClock = at;
    return at;
  }
  private invalidate(): void {
    this.samples = []; this.event = null; this.armed = false;
    this.state = "invalid";
  }
  feed(bytes: Uint8Array): void {
    if (!this.connected) return;
    if (bytes.length > MAX_CHUNK) { this.invalidate(); this.frame = ""; this.dropping = true; return; }
    for (const byte of bytes) {
      if (byte === 10) {
        if (this.dropping) this.invalidate();
        else {
          const match = /^([0-9]{3})\.([0-9]{3})\r$/.exec(this.frame);
          if (!match) this.invalidate();
          else this.sample(Number(match[1]) * 1000 + Number(match[2]));
        }
        this.frame = ""; this.dropping = false;
      } else if (!this.dropping) {
        if (byte > 127 || this.frame.length >= MAX_FRAME - 1) {
          this.frame = ""; this.dropping = true; this.invalidate();
        } else this.frame += String.fromCharCode(byte);
      }
    }
  }
  private sample(grams: number): void {
    const at = this.now();
    if (this.lastSampleAt !== null && at - this.lastSampleAt > FRESH_MS) this.invalidate();
    this.lastSampleAt = at;
    if (grams !== 0 && (grams < MIN_GRAMS || grams > MAX_GRAMS || grams % STEP_GRAMS !== 0)) {
      this.invalidate(); return;
    }
    // Never let zero and a positive reading belong to the same stability window.
    const zero = grams === 0;
    const first = this.samples[0];
    if (first && ((first.grams === 0) !== zero || this.samples.some(s => Math.abs(s.grams - grams) > SPREAD_GRAMS))) {
      this.samples = []; this.event = null;
    }
    if (this.event && (zero || Math.abs(this.event.grams - grams) > SPREAD_GRAMS)) this.event = null;
    // One timestamp cannot establish temporal stability; keep a bounded window.
    if (this.samples.at(-1)?.at === at) return;
    this.samples.push({ grams, at });
    if (this.samples.length > 256) this.samples.shift();
    while (this.samples.length > MIN_SAMPLES && at - this.samples[1]!.at >= WINDOW_MS) this.samples.shift();
    const stable = this.samples.length >= MIN_SAMPLES &&
      at - this.samples[0]!.at >= WINDOW_MS &&
      Math.max(...this.samples.map(s => s.grams)) - Math.min(...this.samples.map(s => s.grams)) <= SPREAD_GRAMS;
    if (!stable) { this.state = this.event ? "ready" : "changing"; return; }
    if (zero) { this.armed = true; this.event = null; this.state = "waiting_weight"; return; }
    if (this.armed) {
      this.event = { eventId: randomUUID(), grams, at };
      this.armed = false;
    }
    this.state = this.event ? "ready" : "waiting_zero";
  }
  status(): ScaleState {
    if (!this.connected) return "disconnected";
    const at = this.now();
    if ((this.event && at - this.event.at > FRESH_MS) ||
        (this.lastSampleAt !== null && at - this.lastSampleAt > FRESH_MS)) {
      this.invalidate(); this.state = "stale";
    }
    return this.state;
  }
  /** An event can be consumed exactly once before expiry. The service will
   * additionally bind consumption to the authorized register and sale line.
   */
  consume(): ScaleMeasurement | null {
    if (this.status() !== "ready" || !this.event) return null;
    const { eventId, grams, at } = this.event;
    const ageMs = this.now() - at;
    if (ageMs > FRESH_MS) { this.invalidate(); this.state = "stale"; return null; }
    this.event = null; this.state = "waiting_zero";
    return { session: this.session, eventId, grams,
      kg: String(Math.floor(grams / 1000)) + "." + String(grams % 1000).padStart(3, "0"),
      ageMs };
  }
}
