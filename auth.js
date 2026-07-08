// Logowanie i sesje - scrypt (node:crypto) + podpisany HMAC token w cookie HttpOnly
import crypto from 'node:crypto';
import { db } from './db.js';

const SESJA_DNI = 14;
const HASLO_DOMYSLNE = 'wpip-crm-2026';

// Sekret sesji: trwaly, generowany raz i trzymany w bazie (przezywa restarty)
function sekretSesji() {
  let row = db.prepare(`SELECT wartosc FROM konfiguracja WHERE klucz = 'sesja_sekret'`).get();
  if (!row) {
    const sekret = crypto.randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO konfiguracja (klucz, wartosc) VALUES ('sesja_sekret', ?)`).run(sekret);
    row = { wartosc: sekret };
  }
  return row.wartosc;
}

export function hashHasla(haslo) {
  const sol = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(haslo, sol, 64).toString('hex');
  return `${sol}:${hash}`;
}

export function weryfikujHaslo(haslo, zapis) {
  const [sol, hash] = String(zapis || '').split(':');
  if (!sol || !hash) return false;
  const proba = crypto.scryptSync(haslo, sol, 64);
  const oryginal = Buffer.from(hash, 'hex');
  return proba.length === oryginal.length && crypto.timingSafeEqual(proba, oryginal);
}

function podpisz(dane) {
  return crypto.createHmac('sha256', sekretSesji()).update(dane).digest('hex');
}

export function tokenSesji(uzytkownikId) {
  const wygasa = Date.now() + SESJA_DNI * 24 * 3600 * 1000;
  const dane = `${uzytkownikId}.${wygasa}`;
  return `${dane}.${podpisz(dane)}`;
}

export function odczytajToken(token) {
  const czesci = String(token || '').split('.');
  if (czesci.length !== 3) return null;
  const [id, wygasa, podpis] = czesci;
  const dane = `${id}.${wygasa}`;
  const oczekiwany = podpisz(dane);
  if (podpis.length !== oczekiwany.length ||
      !crypto.timingSafeEqual(Buffer.from(podpis), Buffer.from(oczekiwany))) return null;
  if (Number(wygasa) < Date.now()) return null;
  return Number(id);
}

function cookieSesji(req) {
  const naglowek = req.headers.cookie || '';
  const para = naglowek.split(';').map(s => s.trim()).find(s => s.startsWith('sesja='));
  return para ? para.slice('sesja='.length) : null;
}

// Middleware: kazde /api poza /api/login wymaga waznej sesji
export function wymagajSesji(req, res, next) {
  if (req.path === '/login') return next();
  const id = odczytajToken(cookieSesji(req));
  if (!id) return res.status(401).json({ error: 'Wymagane logowanie' });
  const uzytkownik = db.prepare('SELECT id, login, imie FROM uzytkownicy WHERE id = ?').get(id);
  if (!uzytkownik) return res.status(401).json({ error: 'Wymagane logowanie' });
  req.uzytkownik = uzytkownik;
  next();
}

// Seed konta przy pustej tabeli: login/haslo z env (Railway) lub domyslne lokalnie
export function seedUzytkownika() {
  const ilu = db.prepare('SELECT COUNT(*) c FROM uzytkownicy').get().c;
  if (ilu > 0) return;
  const login = process.env.CRM_LOGIN || 'krystian';
  const haslo = process.env.CRM_HASLO || HASLO_DOMYSLNE;
  db.prepare('INSERT INTO uzytkownicy (login, haslo_hash, imie) VALUES (?,?,?)')
    .run(login, hashHasla(haslo), process.env.CRM_IMIE || 'Krystian');
  console.log(`Utworzono konto uzytkownika: ${login}` +
    (process.env.CRM_HASLO ? '' : ` (haslo domyslne: ${HASLO_DOMYSLNE} — zmien w Ustawieniach po zalogowaniu)`));
}

export function trasyAuth(api) {
  api.post('/login', (req, res) => {
    const { login, haslo } = req.body || {};
    const uzytkownik = db.prepare('SELECT * FROM uzytkownicy WHERE lower(login) = lower(?)').get(String(login || ''));
    if (!uzytkownik || !weryfikujHaslo(String(haslo || ''), uzytkownik.haslo_hash)) {
      return res.status(401).json({ error: 'Błędny login lub hasło' });
    }
    const token = tokenSesji(uzytkownik.id);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie',
      `sesja=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESJA_DNI * 24 * 3600}${secure ? '; Secure' : ''}`);
    res.json({ ok: true, imie: uzytkownik.imie, login: uzytkownik.login });
  });

  api.post('/wyloguj', (req, res) => {
    res.setHeader('Set-Cookie', 'sesja=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  api.get('/me', (req, res) => {
    res.json({ imie: req.uzytkownik.imie, login: req.uzytkownik.login });
  });

  api.post('/zmien-haslo', (req, res) => {
    const { stare, nowe } = req.body || {};
    if (!nowe || String(nowe).length < 8) {
      return res.status(400).json({ error: 'Nowe hasło musi mieć co najmniej 8 znaków' });
    }
    const uzytkownik = db.prepare('SELECT * FROM uzytkownicy WHERE id = ?').get(req.uzytkownik.id);
    if (!weryfikujHaslo(String(stare || ''), uzytkownik.haslo_hash)) {
      return res.status(400).json({ error: 'Obecne hasło jest nieprawidłowe' });
    }
    db.prepare('UPDATE uzytkownicy SET haslo_hash = ? WHERE id = ?').run(hashHasla(String(nowe)), uzytkownik.id);
    res.json({ ok: true });
  });
}
