// Dashboard metryk pipeline v2: konwersja miedzy kamieniami, mediana czasu w etapie,
// powody utraty per etap, skutecznosc typow zadan, coverage Account Management.
import { GET } from '../api.js';
import { el, tabela, badge } from '../ui.js';

export async function widokMetryki(kontener) {
  const m = await GET('/metryki');

  kontener.append(
    el('h1', {}, 'Metryki pipeline'),
    el('p', { class: 'podtytul' }, 'Gdzie tracimy tematy, ile trwa etap, co domyka kamienie. Wsad do korekty biblioteki zadań i kalibracji prawdopodobieństw.'),

    el('div', { class: 'kafle' },
      kafel('Konta AM z planem opieki', m.am_coverage.pokrycie_pct === null ? '—' : m.am_coverage.pokrycie_pct + '%',
        `${m.am_coverage.z_planem} / ${m.am_coverage.konta} kont powracających`),
      kafel('Przeglądy zaległe', String(m.am_coverage.zalegle), 'konta z datą przeglądu w przeszłości')),

    // Lejek konwersji per pipeline
    ...(m.lejek.length ? m.lejek.map(p => el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Konwersja między kamieniami — ', p.pipeline),
      lejekKonwersji(p.etapy))) : [el('div', { class: 'karta-box puste' }, 'Brak danych o przejściach kamieni — pojawią się, gdy tematy zaczną awansować')]),

    // Powody utraty per etap
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Powody utraty per etap'),
      m.utrata.length ? tabela([
        { naglowek: 'Kamień', klasa: 'wysrodkuj', render: u => badge(u.kamien_kod || '—', 'nieb') },
        { naglowek: 'Powód', render: u => u.powod || '— brak kodu —' },
        { naglowek: 'Status', render: u => badge(u.status, u.status === 'recycled' ? 'zolty' : 'czerwony') },
        { naglowek: 'Liczba', klasa: 'liczba', render: u => String(u.c) },
      ], m.utrata) : el('div', { class: 'puste' }, 'Brak zamkniętych tematów')),

    // Skutecznosc typow zadan
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Skuteczność typów zadań'),
      el('div', { class: 'info-box' }, 'Które typy zadań najczęściej kończą się efektem osiągniętym — podpowiedź, w co inwestować czas.'),
      m.zadania.length ? el('div', { style: 'display:flex; flex-direction:column; gap:8px' },
        ...m.zadania.map(z => el('div', { style: 'display:flex; align-items:center; gap:12px' },
          el('div', { style: 'width:160px; font-size:13px' }, z.typ),
          el('div', { style: 'flex:1; background:var(--szary-tlo); border-radius:6px; height:22px; overflow:hidden' },
            el('div', { style: `height:100%; width:${z.skutecznosc || 0}%; background:var(--zielony); min-width:2px` })),
          el('div', { style: 'width:120px; font-size:12px; color:var(--tekst-2); text-align:right' },
            `${z.skutecznosc ?? 0}% (${z.osiagniete}/${z.total})`))))
        : el('div', { class: 'puste' }, 'Brak wykonanych zadań z zapisanym wynikiem')),
  );
}

function kafel(etykieta, wartosc, drobne) {
  return el('div', { class: 'kafel' },
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, wartosc),
    drobne ? el('div', { class: 'drobne' }, drobne) : null);
}

function lejekKonwersji(etapy) {
  const max = Math.max(1, ...etapy.map(e => e.liczba));
  return el('div', { style: 'display:flex; flex-direction:column; gap:6px' },
    ...etapy.map(e => el('div', { style: 'display:flex; align-items:center; gap:12px' },
      el('div', { style: 'width:60px; font-weight:700' }, e.kod),
      el('div', { style: 'flex:1; background:var(--szary-tlo); border-radius:6px; height:26px; overflow:hidden; position:relative' },
        el('div', { style: `height:100%; width:${Math.max(3, Math.round(100 * e.liczba / max))}%; background:linear-gradient(90deg,var(--granat),var(--granat-2)); display:flex; align-items:center; padding-left:8px; color:#fff; font-weight:700; font-size:13px` }, String(e.liczba))),
      el('div', { style: 'width:60px; font-size:12px; color:var(--tekst-2); text-align:right' }, e.konwersja !== null ? `${e.konwersja}%` : ''),
      el('div', { style: 'width:90px; font-size:12px; color:var(--tekst-2); text-align:right' }, e.mediana_dni !== null ? `~${e.mediana_dni} dni` : '—'))),
    el('div', { class: 'legenda', style: 'margin-top:6px' },
      el('span', {}, 'słupek = liczba tematów, które weszły w etap'),
      el('span', {}, '% = konwersja z poprzedniego'),
      el('span', {}, '~dni = mediana czasu w etapie')));
}
