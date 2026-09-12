const HEADER_BYTES = 4;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;

export function encodeFrame(payload: unknown, maxBytes = DEFAULT_MAX_FRAME_BYTES): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (body.byteLength === 0 || body.byteLength > maxBytes) throw new Error("local channel frame size rejected");
  const output = Buffer.allocUnsafe(HEADER_BYTES + body.byteLength);
  output.writeUInt32BE(body.byteLength, 0); body.copy(output, HEADER_BYTES); return output;
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0);
  constructor(private readonly maxBytes = DEFAULT_MAX_FRAME_BYTES) {}
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.byteLength >= HEADER_BYTES) {
      const size = this.buffer.readUInt32BE(0);
      if (size === 0 || size > this.maxBytes) { this.buffer = Buffer.alloc(0); throw new Error("local channel frame size rejected"); }
      if (this.buffer.byteLength < HEADER_BYTES + size) break;
      const body = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + size);
      this.buffer = this.buffer.subarray(HEADER_BYTES + size);
      try { messages.push(JSON.parse(body.toString("utf8"))); }
      catch { this.buffer = Buffer.alloc(0); throw new Error("local channel frame JSON rejected"); }
    }
    return messages;
  }
}
