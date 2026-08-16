import { ILogService, LogLevel } from './log';

const PREFIX: Record<Exclude<LogLevel, LogLevel.Off>, string> = {
  [LogLevel.Trace]: '[trace]',
  [LogLevel.Debug]: '[debug]',
  [LogLevel.Info]: '[info] ',
  [LogLevel.Warning]: '[warn] ',
  [LogLevel.Error]: '[error]',
};

/** Writes to the process's stdout/stderr via `console` — the only {@link ILogService} implementation for now; a file-backed or remote-telemetry one can be added later behind the same interface. */
export class ConsoleLogService implements ILogService {
  private level: LogLevel = LogLevel.Info;
  /** Optional forwarding hook to the renderer's Output panel, set once a BrowserWindow exists; surfaces the whole main process's activity through this one ILogService instance. */
  private sink: ((line: string) => void) | null = null;
  /** Buffers startup logging (before a BrowserWindow exists to attach a sink to) so it isn't lost; capped so a pathological pre-window burst can't grow unbounded. */
  private readonly buffer: string[] = [];
  private static readonly MAX_BUFFER = 200;

  setBroadcastSink(sink: ((line: string) => void) | null): void {
    this.sink = sink;
    if (sink) {
      for (const line of this.buffer) sink(line);
      this.buffer.length = 0;
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  trace(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Trace, message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Debug, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Info, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write(LogLevel.Warning, message, args);
  }

  error(message: string | Error, ...args: unknown[]): void {
    const text = message instanceof Error ? (message.stack ?? message.message) : message;
    this.write(LogLevel.Error, text, args);
  }

  private write(level: Exclude<LogLevel, LogLevel.Off>, message: string, args: unknown[]): void {
    if (level < this.level) {
      return;
    }
    const line = `${PREFIX[level]} ${message}`;
    const consoleMethod = level >= LogLevel.Error ? console.error : level >= LogLevel.Warning ? console.warn : console.log;
    consoleMethod(line, ...args);
    // Extra args are already visible in the real stdout/stderr above — the Output panel line stays plain text.
    if (this.sink) {
      this.sink(line);
    } else {
      this.buffer.push(line);
      if (this.buffer.length > ConsoleLogService.MAX_BUFFER) this.buffer.shift();
    }
  }
}
