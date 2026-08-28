const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|private.?key|secret|token)/i;
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
export interface LogSink { write(record: LogRecord): void; }

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return "[DEPTH_LIMIT]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1, seen));
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(item, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

export function redactFields(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return sanitize(fields, 0, new WeakSet()) as Readonly<Record<string, unknown>>;
}

export class StructuredLogger {
  constructor(private readonly sink: LogSink, private readonly now: () => Date = () => new Date()) {}
  log(level: LogLevel, event: string, fields: Readonly<Record<string, unknown>> = {}, correlationId?: string): void {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(event)) throw new Error("invalid log event");
    this.sink.write({
      timestamp: this.now().toISOString(),
      level,
      event,
      ...(correlationId === undefined ? {} : { correlation_id: correlationId }),
      fields: redactFields(fields),
    });
  }
}
