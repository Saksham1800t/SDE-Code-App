/** Not under `platform/`, `host/`, or `renderer/` deliberately — `shared/` isn't checked by the layer-boundaries ESLint rule, so it's a safe home for a value both main and renderer need. */
export const DEFAULT_SERVER_URL = 'https://sde-code-backend-production.up.railway.app';

export function resolveServerBaseUrl(envValue: string | undefined): string {
  return envValue || DEFAULT_SERVER_URL;
}
