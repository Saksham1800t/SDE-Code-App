import { createServiceIdentifier, type IExtensionContextProvider } from '../../platform';
import { IExtensionHostService } from '../runtime';

interface ContextProviderRegistrationPayload {
  id: string;
  callbackId: string;
}

export const IAiContextProviderRegistry = createServiceIdentifier<IExtensionContextProvider>('aiContextProviderRegistry');

/** Implements IExtensionContextProvider; queries all registered providers in parallel via Promise.allSettled so one rejecting doesn't drop the rest. */
export class AIContextProviderRegistry implements IExtensionContextProvider {
  static readonly inject = [IExtensionHostService] as const;
  constructor(private readonly extensionHostService: IExtensionHostService) {}

  async collectContext(request: { activeFilePath?: string; prompt: string }): Promise<string[]> {
    const registrations = this.extensionHostService.getRegistrations('contextProvider');
    const settled = await Promise.allSettled(
      registrations.map((registration) => {
        const payload = registration.payload as ContextProviderRegistrationPayload;
        return this.extensionHostService.invoke<string | null>(registration.extensionId, payload.callbackId, [request]);
      }),
    );
    return settled
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((value): value is string => !!value);
  }
}
