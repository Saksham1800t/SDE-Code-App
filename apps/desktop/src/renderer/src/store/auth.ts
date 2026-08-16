import { create } from 'zustand';
import { resolveServerBaseUrl } from '../../../shared/serverConfig';
import { notify } from './notifications';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: { username: string; email: string } | null;
  isAuthenticated: boolean;
  loading: boolean;

  initialize: () => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  deleteAccount: () => Promise<boolean>;
  refreshSession: () => Promise<string | null>;
}

const API_BASE = `${resolveServerBaseUrl(import.meta.env.VITE_SERVER_URL)}/api/auth`;

// Module-scoped so concurrent refreshSession() callers share one in-flight request, avoiding a race where the second caller's now-rotated token gets rejected.
let inFlightRefresh: Promise<string | null> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  refreshToken: null,
  user: null,
  isAuthenticated: false,
  loading: false,

  initialize: async () => {
    // Tokens live in the encrypted secure store (Electron safeStorage); only
    // the non-sensitive username/email pair stays in plain localStorage.
    const [token, refreshToken] = await Promise.all([
      window.api?.secureStoreGet?.('sde_auth_token') ?? null,
      window.api?.secureStoreGet?.('sde_auth_refresh_token') ?? null,
    ]);
    const userJson = localStorage.getItem('sde_auth_user');
    if (token && refreshToken && userJson) {
      try {
        set({
          token,
          refreshToken,
          user: JSON.parse(userJson),
          isAuthenticated: true
        });
      } catch (e) {
        window.api?.secureStoreDelete?.('sde_auth_token');
        window.api?.secureStoreDelete?.('sde_auth_refresh_token');
        localStorage.removeItem('sde_auth_user');
      }
    }
  },

  register: async (username, email, password) => {
    set({ loading: true });
    try {
      const response = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Registration failed.');
      }

      await window.api?.secureStoreSet?.('sde_auth_token', data.token);
      await window.api?.secureStoreSet?.('sde_auth_refresh_token', data.refreshToken);
      localStorage.setItem('sde_auth_user', JSON.stringify({ username: data.username, email: data.email }));

      set({
        token: data.token,
        refreshToken: data.refreshToken,
        user: { username: data.username, email: data.email },
        isAuthenticated: true,
        loading: false
      });
      return true;
    } catch (err: any) {
      notify.error(err.message);
      set({ loading: false });
      return false;
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Login failed.');
      }

      await window.api?.secureStoreSet?.('sde_auth_token', data.token);
      await window.api?.secureStoreSet?.('sde_auth_refresh_token', data.refreshToken);
      localStorage.setItem('sde_auth_user', JSON.stringify({ username: data.username, email: data.email }));

      set({
        token: data.token,
        refreshToken: data.refreshToken,
        user: { username: data.username, email: data.email },
        isAuthenticated: true,
        loading: false
      });
      return true;
    } catch (err: any) {
      notify.error(err.message);
      set({ loading: false });
      return false;
    }
  },

  logout: () => {
    const token = get().token;
    window.api?.secureStoreDelete?.('sde_auth_token');
    window.api?.secureStoreDelete?.('sde_auth_refresh_token');
    localStorage.removeItem('sde_auth_user');

    if (token) {
      fetch(`${API_BASE}/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }).catch(() => {});
    }

    set({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false
    });
  },

  // Unlike logout(), this awaits the server response first so a failed delete leaves the user logged in.
  deleteAccount: async () => {
    const token = get().token;
    if (!token) {
      notify.error('You must be logged in to delete your account.');
      return false;
    }
    set({ loading: true });
    try {
      const response = await fetch(`${API_BASE}/me`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to delete account.');
      }

      await window.api?.secureStoreDelete?.('sde_auth_token');
      await window.api?.secureStoreDelete?.('sde_auth_refresh_token');
      localStorage.removeItem('sde_auth_user');

      set({
        token: null,
        refreshToken: null,
        user: null,
        isAuthenticated: false,
        loading: false
      });
      return true;
    } catch (err: any) {
      notify.error(err.message);
      set({ loading: false });
      return false;
    }
  },

  refreshSession: async () => {
    if (inFlightRefresh) return inFlightRefresh;

    inFlightRefresh = (async () => {
      const refreshToken = (await window.api?.secureStoreGet?.('sde_auth_refresh_token')) || get().refreshToken;
      if (!refreshToken) {
        get().logout();
        return null;
      }

      try {
        const response = await fetch(`${API_BASE}/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });

        if (!response.ok) {
          throw new Error('Failed to refresh session.');
        }

        const data = await response.json();
        await window.api?.secureStoreSet?.('sde_auth_token', data.token);
        await window.api?.secureStoreSet?.('sde_auth_refresh_token', data.refreshToken);

        set({
          token: data.token,
          refreshToken: data.refreshToken,
          isAuthenticated: true
        });

        return data.token;
      } catch (err) {
        get().logout();
        return null;
      }
    })();

    try {
      return await inFlightRefresh;
    } finally {
      inFlightRefresh = null;
    }
  }
}));

export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authStore = useAuthStore.getState();
  let token = authStore.token;

  const headers = {
    ...options.headers,
  } as Record<string, string>;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    const newToken = await authStore.refreshSession();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
}
