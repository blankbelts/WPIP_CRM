// Pulpit - KPI, pipeline wg kamieni, przychod kwartalny, zadania tygodnia
import { GET } from '../api.js';
import { el, mln, pct, dataPl, badgePriorytet, badgeStatus, tabela } from '../ui.js';

export async function widokPulpit(kontener) {
  const d = await GET('/dashboard');

  const prio = Object.fromEntries(d.leady_wg_priorytetu.map(x => [x.priorytet, x.c]));
  const dec = Object.fromEntries(d.decyzje_komitetu.map(x => [x.decyzja, x.c]));

  kontener.append(
    el('h1', {}, 'Pulpit'),
    el('p', { class: 'podtytul' }, 'New Business: od sygnału inwestycyjnego do wygranego kontraktu'),

    el('div', { class: 'kafle' },
      kafel('Wartość pipeline', mln(d.wartosc_pipeline) + ' PLN', `${d.tematy_otwarte} tematów otwartych`),
      kafel('Pipeline ważony', mln(d.wartosc_wazona) + ' PLN', 'suma wartość × prawdopodobieństwo'),
      kafel('Win rate', d.win_rate === null ? '—' : d.win_rate + '%', `${d.wygrane} wygranych / ${d.przegrane} przegranych (baseline ~23%)`),
      kafel('Leady priorytet A', prio.A || 0, `B: ${prio.B || 0} · C: ${prio.C || 0} · D: ${prio.D || 0} · X: ${prio.X || 0}`),
      kafel('Kolejka Komitetu', d.kolejka_komitetu, `bid: ${dec.bid || 0} · no bid: ${dec.no_bid || 0} · defer: ${dec.defer || 0}`),
    ),

    el('div', { style: 'display:grid; grid-template-columns: 1fr 1fr; gap:18px; align-items:start;' },
      el('div', { class: 'karta-box' },
        el('h2', { style: 'margin-top:0' }, 'Tematy wg kamienia milowego'),
        Object.keys(d.tematy_wg_kamienia).length
          ? el('table', {}, el('tbody', {},
              ...Object.entries(d.tematy_wg_kamienia).map(([k, c]) =>
                el('tr', {}, el('td', {}, k), el('td', { class: 'liczba' }, String(c))))))
          : el('div', { class: 'puste' }, 'Brak otwartych tematów w pipeline')),

      el('div', { class: 'karta-box' },
        el('h2', { style: 'margin-top:0' }, 'Przychód po kwartałach (mln PLN)'),
        d.kwartaly.length ? wykresKwartaly(d.kwartaly) : el('div', { class: 'puste' }, 'Uzupełnij terminy realizacji i czas trwania tematów, aby zobaczyć rozkład'),
        el('div', { class: 'legenda' },
          el('span', {}, el('span', { class: 'kropka', style: 'background:#c7d4e4' }), 'planowany'),
          el('span', {}, el('span', { class: 'kropka', style: 'background:var(--akcent)' }), 'ważony prawdopodobieństwem'))),
    ),

    el('h2', {}, 'Działania na najbliższy tydzień'),
    tabela([
      { naglowek: 'Termin', render: w => dataPl(w.termin) },
      { naglowek: 'Cel (rezultat od klienta)', render: w => w.cel },
      { naglowek: 'Typ', render: w => w.typ || '—' },
      { naglowek: 'Dotyczy', render: w => w.temat_identyfikator || w.lead_nazwa || '—' },
      { naglowek: 'Status', render: w => badgeStatus(w.status) },
    ], d.dzialania_tydzien,
      w => location.hash = w.temat_id ? `#/tematy/${w.temat_id}` : (w.lead_id ? `#/leady/${w.lead_id}` : '#/dzialania')),
  );
}

function kafel(etykieta, wartosc, drobne) {
  return el('div', { class: 'kafel' },
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, String(wartosc)),
    drobne ? el('div', { class: 'drobne' }, drobne) : null);
}

function wykresKwartaly(kwartaly) {
  const max = Math.max(...kwartaly.map(k => k.planowany), 1);
  return el('div', { class: 'wykres-kw' },
    ...kwartaly.slice(0, 8).map(k =>
      el('div', { class: 'slupek-grupa' },
        el('div', { class: 'slupki' },
          el('div', { class: 'slupek plan', style: `height:${Math.round(100 * k.planowany / max)}%`, title: `Plan: ${k.planowany.toFixed(1)} mln` }),
          el('div', { class: 'slupek wazony', style: `height:${Math.round(100 * k.wazony / max)}%`, title: `Ważony: ${k.wazony.toFixed(1)} mln` })),
        el('div', { class: 'podpis' }, k.kwartal))));
}
