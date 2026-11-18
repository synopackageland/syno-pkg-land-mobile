const lan = (h: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(h) || h.endsWith('.local') || !h.includes('.') || h === '[::1]';
export function normalizeServer(input: string): { origin: string; insecure: boolean } {
  let value = input.trim();
  if (!value) throw new Error('ADDRESS_EMPTY');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    const probe = new URL(`http://${value}`);
    value = `${probe.port === '5000' || probe.port === '80' || (!probe.port && lan(probe.hostname)) ? 'http' : 'https'}://${value}`;
  }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('ADDRESS_INVALID');
  return { origin: url.origin, insecure: url.protocol === 'http:' };
}
export function sameOrigin(value: string, origin: string): boolean {
  try { const u = new URL(value); return u.origin === origin && !u.username && !u.password && /^https?:$/.test(u.protocol); } catch { return false; }
}
export function launchUrl(value: string, launch: { link?: string; intake?: string } = {}): string {
  const u = new URL(value);
  u.searchParams.set('launch', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (launch.link) u.searchParams.set('link', launch.link);
  if (launch.intake) u.searchParams.set('intake', launch.intake);
  return u.href;
}
