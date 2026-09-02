const KEY = 'punch:appPassword';

export function getStoredPassword(): string | null {
  return localStorage.getItem(KEY);
}
export function setStoredPassword(pw: string) {
  localStorage.setItem(KEY, pw);
}

export async function checkAuthRequired(): Promise<boolean> {
  const r = await fetch('/api/auth/status');
  const { required } = await r.json();
  return !!required;
}

export async function verifyPassword(pw: string): Promise<boolean> {
  const r = await fetch('/api/auth/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (!r.ok) return false;
  const { ok } = await r.json();
  return !!ok;
}

// Attach the stored password to every same-origin /api/ request automatically,
// so every other module's fetch calls stay untouched — this is the one place
// that needs to know the gate exists.
const origFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('/api/') && url !== '/api/auth/status' && url !== '/api/auth/check') {
    const pw = getStoredPassword();
    if (pw) {
      init = { ...(init || {}), headers: { ...(init?.headers || {}), 'x-app-password': pw } };
    }
  }
  return origFetch(input as any, init);
}) as typeof window.fetch;
