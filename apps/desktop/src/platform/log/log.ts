import { createServiceIdentifier } from '../instantiation';

export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warning = 3,
  Error = 4,
  Off = 5,
}

/** The first service registered through the DI container — deliberately the simplest possible one, so a container bug shows up as "logging is broken," not hidden inside something complex. */
export interface ILogService {
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;

  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
}

export const ILogService = createServiceIdentifier<ILogService>('logService');
