import { ILogService, LogLevel } from './log';

/** Minimal ILogService test double: records error()/debug() calls instead of printing them, so a test can assert something logged without console noise. */
export class FakeLogService implements ILogService {
  readonly errors: unknown[][] = [];
  readonly debugs: unknown[][] = [];
  private level = LogLevel.Info;

  setLevel(level: LogLevel): void {
    this.level = level;
  }
  getLevel(): LogLevel {
    return this.level;
  }
  trace(): void {}
  debug(message: string, ...args: unknown[]): void {
    this.debugs.push([message, ...args]);
  }
  info(): void {}
  warn(): void {}
  error(message: string | Error, ...args: unknown[]): void {
    this.errors.push([message, ...args]);
  }
}
