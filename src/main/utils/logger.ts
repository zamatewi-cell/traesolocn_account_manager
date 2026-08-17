import { app } from 'electron';
import path from 'path';
import fs from 'fs';

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private logFilePath: string | null = null;
  private initialized = false;

  private initFile(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const userData = app.getPath('userData');
      this.logFilePath = path.join(userData, 'app.log');
      fs.mkdirSync(userData, { recursive: true });
    } catch {
      this.logFilePath = null;
    }
  }

  private write(level: string, args: unknown[]): void {
    const line = `[${level}] ${new Date().toISOString()} ${formatArgs(args)}`;
    console.log(line);
    this.initFile();
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, line + '\n');
      } catch {
        // ignore file write errors
      }
    }
  }

  debug(...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      this.write('DEBUG', args);
    }
  }

  info(...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      this.write('INFO', args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      this.write('WARN', args);
    }
  }

  error(...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      this.write('ERROR', args);
    }
  }

  /** Absolute path of the log file (may be null if userData is unavailable). */
  getLogFilePath(): string | null {
    this.initFile();
    return this.logFilePath;
  }
}

export const logger = new Logger();
