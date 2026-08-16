import type { StatusBarItemOptions } from '@sde-code/sdk';
import { createServiceIdentifier } from '../../platform';
import { IExtensionHostService } from '../runtime';

export interface StatusBarItemInfo {
  id: string;
  extensionId: string;
  options: StatusBarItemOptions;
}

export interface IStatusBarRegistry {
  list(): StatusBarItemInfo[];
}

export const IStatusBarRegistry = createServiceIdentifier<IStatusBarRegistry>('statusBarRegistry');

interface StatusBarRegistrationPayload {
  id: string;
  options: StatusBarItemOptions;
}

export class StatusBarRegistry implements IStatusBarRegistry {
  static readonly inject = [IExtensionHostService] as const;
  constructor(private readonly extensionHostService: IExtensionHostService) {}

  list(): StatusBarItemInfo[] {
    return this.extensionHostService.getRegistrations('statusBarItem').map((registration) => {
      const payload = registration.payload as StatusBarRegistrationPayload;
      return { id: payload.id, extensionId: registration.extensionId, options: payload.options };
    });
  }
}
