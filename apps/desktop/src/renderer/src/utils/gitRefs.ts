export interface GitRefBadge {
  label: string;
  color: string;
}

export function parseRefs(refs: string): GitRefBadge[] {
  if (!refs) return [];
  return refs.split(',').map(r => r.trim()).filter(Boolean).map(r => {
    if (r.startsWith('HEAD -> ')) return { label: r.replace('HEAD -> ', ''), color: '#38bdf8' };
    if (r.startsWith('origin/')) return { label: r, color: '#a78bfa' };
    if (r === 'HEAD') return { label: 'HEAD', color: '#f59e0b' };
    return { label: r, color: '#34d399' };
  });
}
