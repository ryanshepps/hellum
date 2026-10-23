type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Readonly<Record<string, string | number | boolean | null | undefined>>;

function write(level: LogLevel, message: string, fields: LogFields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  process.stderr.write(`${line}\n`);
}

export const log = {
  debug: (message: string, fields: LogFields = {}) => write("debug", message, fields),
  info: (message: string, fields: LogFields = {}) => write("info", message, fields),
  warn: (message: string, fields: LogFields = {}) => write("warn", message, fields),
  error: (message: string, fields: LogFields = {}) => write("error", message, fields),
};
