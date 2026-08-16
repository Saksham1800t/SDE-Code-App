import type { DesktopApi } from '../../../preload';

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export {};
