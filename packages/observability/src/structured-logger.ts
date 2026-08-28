const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|private.?key|secret|token)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const MAX_DEPTH = 8;
const MAX_ARRAY = 100;

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly correlation_id?: string;
  readonly fields: Readonly<Record<string, unknown>>;
}
export interface LogSink { write(record: LogRecord): void | Promise<void>; }
export interface StructuredLoggerOptions {
  readonly maxPendingRecords?: number;
  readonly sensitiveValues?: readonly string[];
}

function redactString(value: string, sensitiveValues: readonly string[]): string {
  let output = value.replace(BEARER_VALUE, "Bearer [REDACTED]");
  for (const secret of sensitiveValues) {
    if (secret.length >= 4) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  sensitiveValues: readonly string[],
): unknown {
  if (depth > MAX_DEPTH) return "[DEPTH_LIMIT]";
  if (typeof value === "string") return redactString(value, sensitiveValues);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, sensitiveValues),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1, seen, sensitiveValues));
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : sanitize(item, depth + 1, seen, sensitiveValues);
  }
  seen.delete(value);
  return output;
}

export function redactFields(
  fields: Readonly<Record<string, unknown>>,
  sensitiveValues: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return sanitize(fields, 0, new WeakSet(), sensitiveValues) as Readonly<Record<string, unknown>>;
}

export class StructuredLogger {
  private readonly maxPendingRecords: number;
  private readonly sensitiveValues: readonly string[];
  private pendingRecords = 0;
  private tail: Promise<void> = Promise.resolve();
  private sinkFailure: unknown;

  constructor(
    private readonly sink: LogSink,
    private readonly now: () => Date = () => new Date(),
    options: StructuredLoggerOptions = {},
  ) {
    this.maxPendingRecords = options.maxPendingRecords ?? 1_024;
    if (!Number.isSafeInteger(this.maxPendingRecords) || this.maxPendingRecords <= 0) {
      throw new Error("maxPendingRecords must be a positive integer");
    }
    this.sensitiveValues = [...(options.sensitiveValues ?? [])];
  }

  log(
    level: LogLevel,
    event: string,
    fields: Readonly<Record<string, unknown>> = {},
    correlationId?: string,
  ): void {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(event)) throw new Error("invalid log event");
    if (this.sinkFailure !== undefined) throw new Error("log sink is failed", { cause: this.sinkFailure });
    if (this.pendingRecords >= this.maxPendingRecords) throw new Error("log buffer capacity exceeded");

    const record: LogRecord = {
      timestamp: this.now().toISOString(),
      level,
      event,
      ...(correlationId === undefined ? {} : { correlation_id: redactString(correlationId, this.sensitiveValues) }),
      fields: redactFields(fields, this.sensitiveValues),
    };

    this.pendingRecords += 1;
    const write = this.tail.then(async () => {
      await this.sink.write(record);
    });
    this.tail = write
      .catch((error: unknown) => {
        if (this.sinkFailure === undefined) this.sinkFailure = error;
      })
      .finally(() => {
        this.pendingRecords -= 1;
      });
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.sinkFailure !== undefined) {
      throw new Error("log sink failed", { cause: this.sinkFailure });
    }
  }
}
