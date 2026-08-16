/** Encrypted-at-rest key/value storage for secrets, backed by Electron's `safeStorage`; the renderer only sees opaque get/set/delete calls. */
export type SecureStoreIpcContract = {
  'secureStore:set': (key: string, value: string) => Promise<void>;
  'secureStore:get': (key: string) => Promise<string | null>;
  'secureStore:delete': (key: string) => Promise<void>;
};
