// Klient API + pamiec podreczna slownikow
export async function api(sciezka, opcje = {}) {
  const res = await fetch('/api' + sciezka, {
    headers: { 'Content-Type': 'application/json' },
    ...opcje,
    body: opcje.body ? JSON.stringify(opcje.body) : undefined,
  });
  if (res.status === 401) { location.reload(); throw new Error('Wymagane logowanie'); }
  const dane = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dane.error || `Blad ${res.status}`);
  return dane;
}

export const GET = (s) => api(s);
export const POST = (s, body) => api(s, { method: 'POST', body });
export const PUT = (s, body) => api(s, { method: 'PUT', body });
export const DEL = (s) => api(s, { method: 'DELETE' });

let _slowniki = null;
export async function slowniki(odswiez = false) {
  if (!_slowniki || odswiez) _slowniki = await GET('/slowniki');
  return _slowniki;
}

let _karty = null;
export async function karty(odswiez = false) {
  if (!_karty || odswiez) _karty = await GET('/karty');
  return _karty;
}

export function invalidateCache() { _slowniki = null; _karty = null; }
