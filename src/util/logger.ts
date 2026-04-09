export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogMeta {
  phase?: string;
  issueNumber?: number;
  prNumber?: number;
  sha?: string;
  [key: string]: unknown;
}

function log(level: LogLevel, msg: string, meta?: LogMeta): void {
  const entry = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...meta,
  };
  const output = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

export const logger = {
  debug: (msg: string, meta?: LogMeta) => log("debug", msg, meta),
  info:  (msg: string, meta?: LogMeta) => log("info",  msg, meta),
  warn:  (msg: string, meta?: LogMeta) => log("warn",  msg, meta),
  error: (msg: string, meta?: LogMeta) => log("error", msg, meta),
};
