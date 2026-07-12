// Router aplikacji WPIP CRM
import { widokPulpit } from './views/dashboard.js';
import { widokLeady, widokLead } from './views/leady.js';
import { widokImport } from './views/import.js';
import { widokScoring } from './views/scoring.js';
import { widokKomitet } from './views/komitet.js';
import { widokPipeline, widokTemat } from './views/pipeline.js';
import { widokKlienci, widokKlient } from './views/klienci.js';
import { widokPartnerzy } from './views/partnerzy.js';
import { widokRaporty } from './views/raporty.js';
import { widokDzialania } from './views/dzialania.js';
import { widokUstawienia } from './views/ustawienia.js';
import { toast } from './ui.js';

// Widok dostaje (kontener, ...grupy regex, query string)
const trasy = [
  [/^\/$/, widokPulpit],
  [/^\/leady$/, widokLeady],
  [/^\/leady\/(\d+)$/, widokLead],
  [/^\/import$/, widokImport],
  [/^\/scoring$/, widokScoring],
  [/^\/komitet$/, widokKomitet],
  [/^\/pipeline$/, widokPipeline],
  [/^\/tematy\/(\d+)$/, widokTemat],
  [/^\/klienci$/, widokKlienci],
  [/^\/klienci\/(\d+)$/, widokKlient],
  [/^\/partnerzy$/, widokPartnerzy],
  [/^\/raporty$/, widokRaporty],
  [/^\/dzialania$/, widokDzialania],
  [/^\/ustawienia$/, widokUstawienia],
];

export function idz(sciezka) { location.hash = '#' + sciezka; }

async function renderuj() {
  const pelna = location.hash.slice(1) || '/';
  const [sciezka, query = ''] = pelna.split('?');
  const kontener = document.getElementById('widok');

  // Podswietlenie nawigacji (najdluzsze dopasowanie prefiksu)
  let najlepszy = null;
  for (const a of document.querySelectorAll('[data-nav]')) {
    a.classList.remove('aktywny');
    const nav = a.dataset.nav;
    if (sciezka === nav || (nav !== '/' && sciezka.startsWith(nav))) {
      if (!najlepszy || nav.length > najlepszy.dataset.nav.length) najlepszy = a;
    }
  }
  if (sciezka.startsWith('/tematy')) najlepszy = document.querySelector('[data-nav="/pipeline"]');
  if (!najlepszy) najlepszy = document.querySelector('[data-nav="/"]');
  najlepszy?.classList.add('aktywny');

  for (const [wzor, widok] of trasy) {
    const m = sciezka.match(wzor);
    if (m) {
      kontener.innerHTML = '<div class="puste">Ładowanie…</div>';
      try {
        kontener.innerHTML = '';
        await widok(kontener, ...m.slice(1), query);
      } catch (err) {
        console.error(err);
        kontener.innerHTML = '';
        kontener.append(Object.assign(document.createElement('div'), { className: 'puste', textContent: 'Błąd: ' + err.message }));
        toast(err.message, true);
      }
      return;
    }
  }
  kontener.innerHTML = '<div class="puste">Nie znaleziono widoku</div>';
}

// ---- Logowanie ----
function pokazLogowanie() {
  document.querySelector('.layout').style.display = 'none';
  const root = document.getElementById('login-root');
  root.innerHTML = `
    <div class="login-ekran">
      <form class="login-karta" id="login-form">
        <div class="logo" style="padding:0 0 6px">WPIP <span>CRM</span></div>
        <p style="color:var(--tekst-2); margin:0 0 16px">Zaloguj się, aby kontynuować</p>
        <div class="pole"><label>Login</label><input name="login" autocomplete="username" autofocus></div>
        <div style="height:10px"></div>
        <div class="pole"><label>Hasło</label><input name="haslo" type="password" autocomplete="current-password"></div>
        <div id="login-blad" style="color:var(--czerwony); font-size:13px; min-height:20px; margin-top:8px"></div>
        <button class="btn btn-glowny" style="width:100%; justify-content:center" type="submit">Zaloguj</button>
      </form>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: f.login.value, haslo: f.haslo.value }),
    });
    if (r.ok) location.reload();
    else {
      const j = await r.json().catch(() => ({}));
      document.getElementById('login-blad').textContent = j.error || 'Błąd logowania';
    }
  });
}

async function start() {
  const r = await fetch('/api/me');
  if (r.status === 401) { pokazLogowanie(); return; }
  const me = await r.json();
  const info = document.getElementById('uzytkownik-info');
  if (info) {
    info.append(
      Object.assign(document.createElement('span'), { textContent: '👤 ' + (me.imie || me.login) }),
      Object.assign(document.createElement('a'), {
        textContent: 'Wyloguj', href: '#', className: 'wyloguj-link',
        onclick: async (e) => { e.preventDefault(); await fetch('/api/wyloguj', { method: 'POST' }); location.reload(); },
      }));
  }
  window.addEventListener('hashchange', renderuj);
  renderuj();
}
start();
