export type LogLevel = "info" | "debug";

const currentLevel: LogLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) === "debug" ? "debug" : "info";

function timestamp(): string {
  return new Date().toISOString();
}

function format(level: string, component: string, message: string, extra?: Record<string, unknown>): string {
  const parts = [`[${timestamp()}] [${level.toUpperCase()}] [${component}] ${message}`];
  if (extra && Object.keys(extra).length > 0) {
    parts.push(JSON.stringify(extra));
  }
  return parts.join(" ");
}

export const logger = {
  info(component: string, message: string, extra?: Record<string, unknown>): void {
    console.error(format("info", component, message, extra));
  },

  debug(component: string, message: string, extra?: Record<string, unknown>): void {
    if (currentLevel === "debug") {
      console.error(format("debug", component, message, extra));
    }
  },

  warn(component: string, message: string, extra?: Record<string, unknown>): void {
    console.error(format("warn", component, message, extra));
  },

  error(component: string, message: string, extra?: Record<string, unknown>): void {
    console.error(format("error", component, message, extra));
  },

  isDebug(): boolean {
    return currentLevel === "debug";
  },
};

/**
 * Redact sensitive headers (Authorization) for safe logging.
 * Returns a plain object with header names lowercased.
 */
export function safeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "authorization") {
      result[lower] = "Bearer [REDACTED]";
    } else {
      result[lower] = value;
    }
  });
  return result;
}

/**
 * Summarize definition parts for debug logging without exposing payload content.
 * Logs part path, payloadType, and payload byte size only.
 */
export function summarizeDefinitionParts(
  parts: Array<{ path: string; payload: string; payloadType: string }>
): Array<{ path: string; payloadType: string; payloadBytes: number }> {
  return parts.map((p) => ({
    path: p.path,
    payloadType: p.payloadType,
    payloadBytes: p.payload.length,
  }));
}
