// Router aplikacji WPIP CRM
import { widokRoadmapa } from './views/roadmapa.js';
import { widokRecykling } from './views/recykling.js';
import { widokPdca } from './views/pdca.js';
import { widokLejki } from './views/lejki.js';
import { widokLeady, widokLead } from './views/leady.js';
import { widokImport } from './views/import.js';
import { widokImportPipeline } from './views/importPipeline.js';
import { widokScoring } from './views/scoring.js';
import { widokKomitet } from './views/komitet.js';
import { widokPipeline, widokTemat } from './views/pipeline.js';
import { widokPipelineOfertowanie } from './views/pipelineOfertowanie.js';
import { widokKlienci, widokKlient } from './views/klienci.js';
import { widokPartnerzy } from './views/partnerzy.js';
import { widokRaporty } from './views/raporty.js';
import { widokPrognoza } from './views/prognoza.js';
import { widokDzialania } from './views/dzialania.js';
import { widokUstawienia } from './views/ustawienia.js';
import { toast } from './ui.js';
import { ikona } from './ikony.js';

// Ikony nawigacji (mapowanie data-nav -> nazwa ikony)
const IKONY_NAV = {
  '/': 'roadmapa', '/silnik': 'silnik', '/import': 'import', '/leady': 'leady',
  '/scoring': 'scoring', '/komitet': 'komitet', '/pipeline': 'pipeline',
  '/przed-komitetem': 'lejki', '/kampanie': 'kampania',
  '/import-pipeline': 'import', '/recykling': 'recykling', '/prognoza': 'prognoza',
  '/pdca': 'pdca', '/raporty': 'raporty', '/klienci': 'klienci',
  '/partnerzy': 'partnerzy', '/dzialania': 'dzialania', '/lejki': 'lejki', '/ustawienia': 'ustawienia',
};
for (const a of document.querySelectorAll('[data-nav]')) {
  const nazwa = IKONY_NAV[a.dataset.nav];
  if (nazwa) a.prepend(ikona(nazwa, 17));
}

// Widok dostaje (kontener, ...grupy regex, query string)
const trasy = [
  [/^\/$/, widokRoadmapa],
  [/^\/pulpit$/, widokRoadmapa], // Pulpit KPI scalony z Roadmapa - stare linki dzialaja
  [/^\/silnik$/, (k) => { k.innerHTML = '<div class="puste">Widok „Silnik sprzedaży" — w budowie (faza 2).</div>'; }],
  [/^\/kampanie$/, (k) => { k.innerHTML = '<div class="puste">Kampanie — w budowie (faza 3).</div>'; }],
  [/^\/pdca$/, widokPdca],
  // Stary adres metryk prowadzi do karty PDCA — metryki są teraz jej częścią
  [/^\/metryki$/, widokPdca],
  [/^\/lejki$/, widokLejki],
  [/^\/recykling$/, widokRecykling],
  [/^\/leady$/, widokLeady],
  [/^\/leady\/(\d+)$/, widokLead],
  [/^\/import$/, widokImport],
  [/^\/import-pipeline$/, widokImportPipeline],
  [/^\/scoring$/, widokScoring],
  [/^\/komitet$/, widokKomitet],
  // Warstwa 1: arkuszowy podglad tematow w ofertowaniu (po pozytywnym Komitecie)
  [/^\/pipeline$/, widokPipelineOfertowanie],
  // Warstwa 2 (New Business): kanban tematow pracowanych lejkiem do bramki BID
  [/^\/przed-komitetem$/, widokPipeline],
  [/^\/prognoza$/, widokPrognoza],
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
        <div class="logo" style="padding:0 0 6px"><img src="/img/logo-wpip.svg" alt="Grupa WPIP"></div>
        <p style="color:var(--tekst-2); margin:0 0 16px">CRM New Business — zaloguj się, aby kontynuować</p>
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
