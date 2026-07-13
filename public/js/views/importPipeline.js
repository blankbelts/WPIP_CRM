// Import realnego pipeline'u (arkusz Pipeline). Etap interpretowany z % wygranej.
import { POST } from '../api.js';
import { el, toast, badge, mln, dataPl } from '../ui.js';

export async function widokImportPipeline(kontener) {
  kontener.append(
    el('h1', {}, 'Import pipeline'),
    el('p', { class: 'podtytul' },
      'Wczytaj arkusz „Pipeline i kluczowe działania". Etap każdego tematu jest interpretowany z kolumny „Prawdopodobieństwo wygranej" — temat trafia na kamień, w którego pasmo wpada %, a wcześniejsze kamienie są auto-potwierdzone (STANDARD M1–M8).'),
    krokPlik(kontener));
}

function krokPlik(kontener) {
  const input = el('input', { type: 'file', accept: '.xlsx,.xls', style: 'max-width:420px' });
  input.addEventListener('change', async () => {
    const plik = input.files[0];
    if (!plik) return;
    try {
      const base64 = await doBase64(plik);
      const { propozycje } = await POST('/import/pipeline/podglad', { base64 });
      kontener.innerHTML = '';
      kontener.append(
        el('h1', {}, 'Import pipeline'),
        el('p', { class: 'podtytul' }, `${plik.name} — ${propozycje.length} tematów z interpretacją etapu`),
        krokPodglad(kontener, propozycje));
    } catch (err) { toast(err.message, true); }
  });
  return el('div', { class: 'karta-box' },
    el('h2', { style: 'margin-top:0' }, 'Wybierz plik'),
    el('div', { class: 'info-box' }, 'Format: zakładka „Pipeline" z kolumnami Inwestor, Rodzaj inwestycji, Relacja z decydentem, Wartość, Marża, terminy, Prawdopodobieństwo wygranej.'),
    input);
}

function krokPodglad(kontener, propozycje) {
  const zazn = new Map(propozycje.map(p => [p, !p.duplikat]));
  const handlowiec = el('input', { value: 'K. Latoś', style: 'max-width:180px' });
  const podsum = el('div', { class: 'info-box' });
  const odswiezPodsum = () => {
    const wyb = [...zazn.entries()].filter(([, v]) => v).map(([p]) => p);
    const wg = wyb.reduce((a, p) => (a[p.kamien_kod] = (a[p.kamien_kod] || 0) + 1, a), {});
    podsum.textContent = `Do importu: ${wyb.length} tematów — ` + Object.entries(wg).sort().map(([k, c]) => `${k}: ${c}`).join(' · ');
  };
  odswiezPodsum();

  const tbody = el('tbody', {}, ...propozycje.map(p => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = zazn.get(p); cb.disabled = p.duplikat;
    cb.addEventListener('change', () => { zazn.set(p, cb.checked); odswiezPodsum(); });
    return el('tr', { style: p.duplikat ? 'opacity:.5' : '' },
      el('td', { class: 'wysrodkuj' }, cb),
      el('td', { class: 'wysrodkuj' }, badge(p.kamien_kod, p.prawd_pct >= 41 ? 'zielony' : p.prawd_pct >= 21 ? 'nieb' : 'szary')),
      el('td', { class: 'liczba' }, p.prawd_pct != null ? p.prawd_pct + '%' : '—'),
      el('td', {}, el('b', {}, p.inwestor), p.potwierdzone_kody.length ? el('div', { style: 'font-size:11px; color:var(--tekst-2)' }, 'auto-potwierdzone: ' + p.potwierdzone_kody.join(', ')) : ''),
      el('td', {}, p.klient_nazwa || '—'),
      el('td', {}, p.osoba ? p.osoba.imie_nazwisko + (p.osoba.stanowisko ? ` (${p.osoba.stanowisko})` : '') : '—'),
      el('td', { class: 'liczba' }, p.wartosc ? mln(p.wartosc) : '—'),
      el('td', {}, p.rodzaj || '—'),
      el('td', {}, p.duplikat ? badge('już w CRM', 'szary') : ''));
  }));

  return el('div', {},
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Podgląd i interpretacja etapów'),
      podsum,
      el('div', { class: 'filtry' },
        el('span', {}, 'Handlowiec:'), handlowiec,
        el('button', {
          class: 'btn btn-glowny', style: 'margin-left:auto', onclick: async (e) => {
            const wyb = [...zazn.entries()].filter(([, v]) => v).map(([p]) => p);
            if (!wyb.length) { toast('Nie zaznaczono tematów', true); return; }
            e.target.disabled = true;
            try {
              const stat = await POST('/import/pipeline/wykonaj', { wiersze: wyb, handlowiec: handlowiec.value || null });
              kontener.innerHTML = '';
              kontener.append(
                el('h1', {}, 'Import pipeline zakończony'),
                el('div', { class: 'karta-box' },
                  el('div', { class: 'kafle' },
                    kafel('Nowe tematy', stat.tematy_nowe),
                    kafel('Nowi klienci', stat.klienci_nowi),
                    kafel('Nowe osoby', stat.osoby_nowe)),
                  el('div', { style: 'display:flex; gap:10px; margin-top:10px' },
                    el('a', { class: 'btn btn-glowny', href: '#/pipeline' }, 'Zobacz pipeline'),
                    el('a', { class: 'btn', href: '#/prognoza' }, 'Prognoza'))));
              toast(`Zaimportowano ${stat.tematy_nowe} tematów na właściwe kamienie`);
            } catch (err) { toast(err.message, true); e.target.disabled = false; }
          }
        }, 'Importuj zaznaczone'))),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}), el('th', {}, 'Kamień'), el('th', { class: 'liczba' }, '% wygr.'),
        el('th', {}, 'Temat (Inwestor)'), el('th', {}, 'Klient'), el('th', {}, 'Osoba decyzyjna'),
        el('th', { class: 'liczba' }, 'Wartość'), el('th', {}, 'Rodzaj'), el('th', {}, ''))),
      tbody));
}

function kafel(etykieta, wartosc) {
  return el('div', { class: 'kafel' }, el('div', { class: 'etykieta' }, etykieta), el('div', { class: 'wartosc' }, String(wartosc)));
}

function doBase64(plik) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(plik);
  });
}
