// Tiny leveled logger. Writes to stderr so stdout stays clean for --json output.
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOR: Record<Level, string> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };

let threshold: Level = (process.env.LOG_LEVEL as Level) || "info";
const useColor = process.stderr.isTTY && !process.env.NO_COLOR;

export function setLogLevel(level: Level) {
  threshold = level;
}

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope = "grantkosh"): Logger {
  const emit = (level: Level, msg: string, extra?: unknown) => {
    if (ORDER[level] < ORDER[threshold]) return;
    const time = new Date().toISOString().slice(11, 19);
    const tag = level.toUpperCase().padEnd(5);
    const head = useColor ? `${COLOR[level]}${tag}\x1b[0m` : tag;
    const tail = extra === undefined ? "" : " " + (extra instanceof Error ? extra.message : JSON.stringify(extra));
    process.stderr.write(`${time} ${head} [${scope}] ${msg}${tail}\n`);
  };
  return {
    debug: (m, e) => emit("debug", m, e),
    info: (m, e) => emit("info", m, e),
    warn: (m, e) => emit("warn", m, e),
    error: (m, e) => emit("error", m, e),
    child: s => createLogger(`${scope}:${s}`),
  };
}

export const log = createLogger();
