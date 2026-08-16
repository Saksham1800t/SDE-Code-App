import { createServiceIdentifier } from '../../platform';
import { IExtensionHostService } from '../runtime';

export interface CommandInfo {
  id: string;
  extensionId: string;
}

export interface ICommandRegistry {
  /** Every command any activated extension has registered so far. */
  list(): CommandInfo[];
  /** Executes a registered command by ID, returning its real result. */
  execute<T = unknown>(id: string, args: unknown[]): Promise<T>;
}

export const ICommandRegistry = createServiceIdentifier<ICommandRegistry>('commandRegistry');

interface CommandRegistrationPayload {
  id: string;
  callbackId: string;
}

/** A thin, typed read of ExtensionHostService's generic 'command' registrations; deliberately not cached since querying live is cheap and avoids staleness. */
export class CommandRegistry implements ICommandRegistry {
  static readonly inject = [IExtensionHostService] as const;
  constructor(private readonly extensionHostService: IExtensionHostService) {}

  list(): CommandInfo[] {
    return this.extensionHostService.getRegistrations('command').map((registration) => {
      const payload = registration.payload as CommandRegistrationPayload;
      return { id: payload.id, extensionId: registration.extensionId };
    });
  }

  execute<T = unknown>(id: string, args: unknown[]): Promise<T> {
    const registration = this.extensionHostService
      .getRegistrations('command')
      .find((r) => (r.payload as CommandRegistrationPayload).id === id);

    if (!registration) {
      return Promise.reject(new Error(`Unknown extension command: "${id}"`));
    }

    const payload = registration.payload as CommandRegistrationPayload;
    return this.extensionHostService.invoke<T>(registration.extensionId, payload.callbackId, args);
  }
}
