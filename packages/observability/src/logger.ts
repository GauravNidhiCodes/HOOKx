import { LOG_LEVEL_RANK, type LogLevel } from "./levels.js";
import type { LifecycleEvent } from "./lifecycle.js";
import {
  sanitizeLogFields,
  type StructuredLogRecord,
} from "./redact.js";

export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  log(level: LogLevel, message: string, fields?: LogFields): void;
};

export type JsonLoggerOptions = {
  readonly write?: (line: string) => void;
  readonly now?: () => string;
  readonly minLevel?: LogLevel;
};

function defaultNow(): string {
  return new Date().toISOString();
}

export function createJsonLogger(options: JsonLoggerOptions = {}): Logger {
  const write = options.write ?? (() => {});
  const now = options.now ?? defaultNow;
  const minLevel = options.minLevel ?? "INFO";

  function emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[minLevel]) {
      return;
    }
    const sanitized = sanitizeLogFields(fields);
    const timestamp =
      typeof fields?.["timestamp"] === "string" &&
      fields["timestamp"].length > 0
        ? fields["timestamp"]
        : now();
    const record: StructuredLogRecord = {
      timestamp,
      level,
      message,
      ...sanitized,
    };
    write(JSON.stringify(record));
  }

  return {
    debug(message, fields) {
      emit("DEBUG", message, fields);
    },
    info(message, fields) {
      emit("INFO", message, fields);
    },
    warn(message, fields) {
      emit("WARN", message, fields);
    },
    error(message, fields) {
      emit("ERROR", message, fields);
    },
    log(level, message, fields) {
      emit(level, message, fields);
    },
  };
}

export function silentLogger(): Logger {
  return createJsonLogger({ write: () => {} });
}

export function collectingLogger(
  into: StructuredLogRecord[],
  minLevel: LogLevel = "DEBUG",
): Logger {
  return createJsonLogger({
    minLevel,
    write(line) {
      into.push(JSON.parse(line) as StructuredLogRecord);
    },
  });
}

export function lifecycleMessage(lifecycle: LifecycleEvent): string {
  return lifecycle.replaceAll("_", " ");
}
