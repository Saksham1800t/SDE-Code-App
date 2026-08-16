import type { ThemeVariables } from '@sde-code/sdk';
import { createServiceIdentifier } from '../../platform';
import { IExtensionHostService } from '../runtime';

export interface ThemeInfo {
  id: string;
  extensionId: string;
  variables: ThemeVariables;
}

export interface IThemeRegistry {
  list(): ThemeInfo[];
}

export const IThemeRegistry = createServiceIdentifier<IThemeRegistry>('themeRegistry');

interface ThemeRegistrationPayload {
  id: string;
  variables: ThemeVariables;
}

export class ThemeRegistry implements IThemeRegistry {
  static readonly inject = [IExtensionHostService] as const;
  constructor(private readonly extensionHostService: IExtensionHostService) {}

  list(): ThemeInfo[] {
    return this.extensionHostService.getRegistrations('theme').map((registration) => {
      const payload = registration.payload as ThemeRegistrationPayload;
      return { id: payload.id, extensionId: registration.extensionId, variables: payload.variables };
    });
  }
}
