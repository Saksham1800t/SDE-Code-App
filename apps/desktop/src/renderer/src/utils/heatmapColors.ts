export function intensityColor(count: number, max: number): string {
  if (count === 0) return 'color-mix(in srgb, var(--text-primary) 5%, transparent)';
  const p = count / Math.max(max, 1);
  if (p < 0.25) return 'rgba(56,189,248,0.2)';
  if (p < 0.5)  return 'rgba(56,189,248,0.45)';
  if (p < 0.75) return 'rgba(56,189,248,0.7)';
  return 'rgba(56,189,248,1)';
}
