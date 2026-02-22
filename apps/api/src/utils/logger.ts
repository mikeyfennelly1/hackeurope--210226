// ANSI escape codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: "TRACE",
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO ",
  [LogLevel.WARN]: "WARN ",
  [LogLevel.ERROR]: "ERROR",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: DIM,
  [LogLevel.DEBUG]: CYAN,
  [LogLevel.INFO]: GREEN,
  [LogLevel.WARN]: YELLOW,
  [LogLevel.ERROR]: RED,
};

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.toUpperCase()) {
    case "TRACE":
      return LogLevel.TRACE;
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

let activeLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

export function setLogLevel(level: LogLevel): void {
  activeLevel = level;
}

export class Logger {
  private readonly component: string;

  constructor(component: string) {
    this.component = component;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < activeLevel) return;

    const timestamp = `${DIM}${new Date().toISOString()}${RESET}`;
    const color = LEVEL_COLORS[level];
    const levelTag = `${color}${BOLD}[${LEVEL_LABELS[level]}]${RESET}`;
    const componentTag = `${MAGENTA}[${this.component}]${RESET}`;
    const line = `${timestamp} ${levelTag} ${componentTag} ${message}`;

    if (level >= LogLevel.ERROR) {
      console.error(line, ...args);
    } else if (level >= LogLevel.WARN) {
      console.warn(line, ...args);
    } else {
      console.log(line, ...args);
    }
  }

  trace(message: string, ...args: unknown[]): void {
    this.log(LogLevel.TRACE, message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }
}

/**
 * Factory function — get a named logger for a component.
 * Usage: const logger = getLogger("MyComponent");
 */
export function getLogger(component: string): Logger {
  return new Logger(component);
}
