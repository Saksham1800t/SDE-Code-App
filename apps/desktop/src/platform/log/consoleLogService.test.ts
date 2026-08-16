import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLogService } from './consoleLogService';
import { LogLevel } from './log';

describe('ConsoleLogService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to Info level', () => {
    const log = new ConsoleLogService();
    expect(log.getLevel()).toBe(LogLevel.Info);
  });

  it('setLevel/getLevel round-trip', () => {
    const log = new ConsoleLogService();
    log.setLevel(LogLevel.Debug);
    expect(log.getLevel()).toBe(LogLevel.Debug);
  });

  it('suppresses messages below the current level', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = new ConsoleLogService();
    log.setLevel(LogLevel.Warning);

    log.info('should be suppressed');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('passes through messages at or above the current level', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = new ConsoleLogService();
    log.setLevel(LogLevel.Debug);

    log.debug('hello %s', 'world');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('hello %s'), 'world');
  });

  it('routes warn() to console.warn and error() to console.error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new ConsoleLogService();

    log.warn('careful');
    log.error('broken');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('formats an Error argument to error() using its stack', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new ConsoleLogService();
    const err = new Error('boom');

    log.error(err);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('Off suppresses even error()', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new ConsoleLogService();
    log.setLevel(LogLevel.Off);

    log.error('should not print');

    expect(errorSpy).not.toHaveBeenCalled();
  });

  describe('setBroadcastSink', () => {
    it('forwards every written line to the sink, prefixed the same way console output is', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new ConsoleLogService();
      const lines: string[] = [];
      log.setBroadcastSink((line) => lines.push(line));

      log.info('hello');

      expect(lines).toEqual(['[info]  hello']);
    });

    it('respects the current level — a suppressed message never reaches the sink either', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new ConsoleLogService();
      log.setLevel(LogLevel.Warning);
      const lines: string[] = [];
      log.setBroadcastSink((line) => lines.push(line));

      log.info('should be suppressed');

      expect(lines).toEqual([]);
    });

    it('setBroadcastSink(null) detaches the sink', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new ConsoleLogService();
      const lines: string[] = [];
      log.setBroadcastSink((line) => lines.push(line));
      log.setBroadcastSink(null);

      log.info('after detach');

      expect(lines).toEqual([]);
    });

    it('buffers lines written before a sink is attached, then flushes them on attach', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new ConsoleLogService();

      log.info('before window exists');
      log.info('still before');

      const lines: string[] = [];
      log.setBroadcastSink((line) => lines.push(line));

      expect(lines).toEqual(['[info]  before window exists', '[info]  still before']);
    });

    it('does not re-flush the buffer on a later write — only lines written before attach were buffered', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new ConsoleLogService();
      log.info('early');
      const lines: string[] = [];
      log.setBroadcastSink((line) => lines.push(line));

      log.info('after attach');

      expect(lines).toEqual(['[info]  early', '[info]  after attach']);
    });

    it('caps the pre-attach buffer so it cannot grow unbounded', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const log = new ConsoleLogService();

      for (let i = 0; i < 250; i++) log.info(`line ${i}`);

      const lines: string[] = [];
      log.setBroadcastSink((line) => lines.push(line));

      expect(lines).toHaveLength(200);
      expect(lines[0]).toBe('[info]  line 50'); // oldest 50 dropped
      expect(lines[lines.length - 1]).toBe('[info]  line 249');
    });
  });
});
