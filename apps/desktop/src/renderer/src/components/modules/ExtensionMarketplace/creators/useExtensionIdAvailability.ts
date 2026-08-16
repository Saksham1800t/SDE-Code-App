import { useEffect, useState } from 'react';
import { resolveServerBaseUrl } from '../../../../../../shared/serverConfig';

const SERVER_URL = resolveServerBaseUrl(import.meta.env.VITE_SERVER_URL);
const DEBOUNCE_MS = 500;

/**
 * Live-checks a typed extension ID against the marketplace's public search endpoint (the same
 * one the Browse tab uses) so the Theme/Snippets creator wizards can warn about a collision
 * before the user gets all the way to Publish — the backend's own {id, version} uniqueness check
 * still runs at publish time regardless, this is purely an earlier heads-up.
 */
export function useExtensionIdAvailability(id: string): { checking: boolean; taken: boolean } {
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    const trimmed = id.trim();
    if (!trimmed) {
      setTaken(false);
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/extensions?query=${encodeURIComponent(trimmed)}`);
        if (!response.ok || cancelled) return;
        const results: Array<{ id: string }> = await response.json();
        const exists = Array.isArray(results) && results.some((ext) => ext.id === trimmed);
        if (!cancelled) setTaken(exists);
      } catch {
        // A failed check shouldn't block publishing — the backend's own uniqueness
        // check at publish time is the real guard, this is just an early hint.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  return { checking, taken };
}
