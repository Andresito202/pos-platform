import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { LocalChannelFrameSchema, type LocalChannelFrame } from "@pos-platform/contracts";
import * as z from "zod";
import { canonicalJson } from "./canonical-json.js";
import {
  InMemoryReplayStateStore,
  type LocalChannelReplayStateStore,
} from "./replay-state.js";

export interface ChannelClock { now(): Date; }
const systemClock: ChannelClock = { now: () => new Date() };

export interface LocalChannelAuthenticatorOptions {
  readonly maxClockSkewMs?: number;
  readonly maxSessions?: number;
  readonly replayStateStore?: LocalChannelReplayStateStore;
}

function macInput(frame: Omit<LocalChannelFrame, "mac">): string {
  return canonicalJson(frame);
}

function calculateMac(secret: Buffer, frame: Omit<LocalChannelFrame, "mac">): string {
  return createHmac("sha256", secret).update(macInput(frame)).digest("hex");
}

export class LocalChannelAuthenticator {
  private readonly maxClockSkewMs: number;
  private readonly replayStateStore: LocalChannelReplayStateStore;

  private readonly secret: Buffer;

  constructor(
    secret: Buffer,
    private readonly clock: ChannelClock = systemClock,
    options: LocalChannelAuthenticatorOptions = {},
  ) {
    if (secret.byteLength < 32) throw new Error("local channel secret must contain at least 256 bits");
    this.secret = Buffer.from(secret);
    this.maxClockSkewMs = options.maxClockSkewMs ?? 30_000;
    if (!Number.isSafeInteger(this.maxClockSkewMs) || this.maxClockSkewMs <= 0) {
      throw new Error("local channel max clock skew must be a positive integer");
    }
    this.replayStateStore = options.replayStateStore
      ?? new InMemoryReplayStateStore(options.maxSessions ?? 1_024);
  }

  sign(
    payload: unknown,
    protocolVersion: string,
    sessionId: string = randomUUID(),
    sequence = 1,
  ): LocalChannelFrame {
    const unsigned: Omit<LocalChannelFrame, "mac"> = {
      protocol_version: protocolVersion,
      session_id: sessionId,
      sequence,
      nonce: randomBytes(18).toString("base64url"),
      sent_at: this.clock.now().toISOString(),
      payload: z.json().parse(payload),
    };
    return LocalChannelFrameSchema.parse({
      ...unsigned,
      mac: calculateMac(this.secret, unsigned),
    });
  }

  verify(input: unknown): LocalChannelFrame {
    const frame = LocalChannelFrameSchema.parse(input);
    const { mac, ...unsigned } = frame;
    const expected = Buffer.from(calculateMac(this.secret, unsigned), "hex");
    const supplied = Buffer.from(mac, "hex");
    if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) {
      throw new Error("local channel MAC rejected");
    }

    const evaluatedAt = this.clock.now();
    const sentAt = Date.parse(frame.sent_at);
    const skew = Math.abs(evaluatedAt.getTime() - sentAt);
    if (!Number.isFinite(skew) || skew > this.maxClockSkewMs) {
      throw new Error("local channel timestamp rejected");
    }

    this.replayStateStore.accept({
      sessionId: frame.session_id,
      sequence: frame.sequence,
      evaluatedAt: evaluatedAt.toISOString(),
      expiresAt: new Date(sentAt + this.maxClockSkewMs + 1).toISOString(),
    });
    return frame;
  }

  destroy(): void {
    this.secret.fill(0);
  }
}
