import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { LocalChannelFrameSchema, type LocalChannelFrame } from "@pos-platform/contracts";
import * as z from "zod";
import { canonicalJson } from "./canonical-json.js";

export interface ChannelClock { now(): Date; }
const systemClock: ChannelClock = { now: () => new Date() };

function macInput(frame: Omit<LocalChannelFrame, "mac">): string {
  return canonicalJson(frame);
}
function calculateMac(secret: Buffer, frame: Omit<LocalChannelFrame, "mac">): string {
  return createHmac("sha256", secret).update(macInput(frame)).digest("hex");
}

export class LocalChannelAuthenticator {
  private readonly highestSequence = new Map<string, number>();
  constructor(private readonly secret: Buffer, private readonly clock: ChannelClock = systemClock, private readonly maxClockSkewMs = 30_000) {
    if (secret.byteLength < 32) throw new Error("local channel secret must contain at least 256 bits");
  }

  sign(payload: unknown, protocolVersion: string, sessionId: string = randomUUID(), sequence = 1): LocalChannelFrame {
    const unsigned: Omit<LocalChannelFrame, "mac"> = {
      protocol_version: protocolVersion, session_id: sessionId, sequence,
      nonce: randomBytes(18).toString("base64url"), sent_at: this.clock.now().toISOString(), payload: z.json().parse(payload),
    };
    return LocalChannelFrameSchema.parse({ ...unsigned, mac: calculateMac(this.secret, unsigned) });
  }

  verify(input: unknown): LocalChannelFrame {
    const frame = LocalChannelFrameSchema.parse(input);
    const { mac, ...unsigned } = frame;
    const expected = Buffer.from(calculateMac(this.secret, unsigned), "hex");
    const supplied = Buffer.from(mac, "hex");
    if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) throw new Error("local channel MAC rejected");
    const skew = Math.abs(this.clock.now().getTime() - Date.parse(frame.sent_at));
    if (!Number.isFinite(skew) || skew > this.maxClockSkewMs) throw new Error("local channel timestamp rejected");
    const highest = this.highestSequence.get(frame.session_id) ?? 0;
    if (frame.sequence <= highest) throw new Error("local channel replay rejected");
    this.highestSequence.set(frame.session_id, frame.sequence);
    return frame;
  }

  closeSession(sessionId: string): void { this.highestSequence.delete(sessionId); }
}
