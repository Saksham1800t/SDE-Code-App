import type { AITool } from '@sde-code/sdk';
import { createServiceIdentifier, type IExtensionToolProvider } from '../../platform';
import { IExtensionHostService } from '../runtime';

interface AiToolRegistrationPayload {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  callbackId: string;
}

export const IAiToolRegistry = createServiceIdentifier<IExtensionToolProvider>('aiToolRegistry');

/** Implements IExtensionToolProvider so AiService can dispatch extension tools without importing extension-host directly (layer boundary); wired in via a setter from host/services.ts, not constructor injection. */
export class AIToolRegistry implements IExtensionToolProvider {
  static readonly inject = [IExtensionHostService] as const;
  constructor(private readonly extensionHostService: IExtensionHostService) {}

  listTools(): AITool[] {
    return this.extensionHostService.getRegistrations('aiTool').map((registration) => {
      const payload = registration.payload as AiToolRegistrationPayload;
      return {
        name: payload.name,
        description: payload.description,
        parameters: payload.parameters,
        execute: (args: Record<string, unknown>) =>
          this.extensionHostService.invoke<string>(registration.extensionId, payload.callbackId, [args]),
      };
    });
  }
}
