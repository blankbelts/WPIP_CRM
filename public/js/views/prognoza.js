// Prognoza sprzedazy: lejek konwersji + prognoza przychodu kwartalna (pipeline wazony)
// + potencjal New Business z lejka (szacunek wg konwersji baseline 2025)
import { GET } from '../api.js';
import { el, mln } from '../ui.js';

export async function widokPrognoza(kontener) {
  const p = await GET('/prognoza');

  kontener.append(
    el('h1', {}, 'Prognoza sprzedaży'),
    el('p', { class: 'podtytul' }, 'Pipeline ważony prawdopodobieństwem + potencjał New Business z lejka. Założenia konwersji z baseline 2025.'),

    el('div', { class: 'kafle' },
      kafel('Prognoza łączna', mln(p.prognoza_laczna) + ' PLN', 'pipeline ważony + New Business'),
      kafel('Pipeline ważony', mln(p.pipeline.wazona) + ' PLN', `z ${mln(p.pipeline.wartosc)} PLN otwartego pipeline`),
      kafel('Potencjał New Business', mln(p.nowy_biznes.oczekiwany_przychod) + ' PLN', `${p.nowy_biznes.interesujace} interesujących leadów`),
      kafel('Marża prognozowana', mln(p.pipeline.marza_wazona + p.nowy_biznes.oczekiwana_marza) + ' PLN', `${p.zalozenia.sr_marza}% z prognozy`)),

    // Lejek konwersji
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Lejek konwersji New Business'),
      lejek(p.lejek),
      el('p', { class: 'podtytul', style: 'margin:10px 0 0' },
        `Baseline 2025: bid-rate ${Math.round(p.zalozenia.bid_rate * 100)}% · win-rate ${Math.round(p.zalozenia.win_rate * 100)}% · śr. kontrakt ${p.zalozenia.sr_kontrakt} mln PLN`)),

    // Prognoza kwartalna (pipeline wazony)
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Prognoza przychodu po kwartałach (pipeline, mln PLN)'),
      p.kwartaly.length ? el('div', {},
        wykresKwartaly(p.kwartaly),
        el('div', { class: 'legenda' },
          el('span', {}, el('span', { class: 'kropka', style: 'background:#c7d4e4' }), 'planowany (100%)'),
          el('span', {}, el('span', { class: 'kropka', style: 'background:var(--akcent)' }), 'ważony prawdopodobieństwem')),
        el('table', { style: 'margin-top:14px' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Kwartał'), el('th', { class: 'liczba' }, 'Planowany'), el('th', { class: 'liczba' }, 'Ważony'))),
          el('tbody', {}, ...p.kwartaly.map(k => el('tr', {},
            el('td', {}, k.kwartal),
            el('td', { class: 'liczba' }, mln(k.planowany)),
            el('td', { class: 'liczba' }, mln(k.wazony)))))))
        : el('div', { class: 'puste' }, 'Brak tematów z terminem realizacji i wartością — uzupełnij dane tematów w pipeline, aby zobaczyć rozkład kwartalny')),

    // Potencjal New Business z lejka
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Potencjał New Business (szacunek z lejka)'),
      el('div', { class: 'info-box' },
        'Szacunek na bazie konwersji 2025: interesujące leady × bid-rate = oczekiwane tematy; × win-rate = oczekiwane wygrane; × średni kontrakt = przychód. To potencjał leadów jeszcze przed pipeline — orientacyjny, nie zobowiązujący.'),
      el('div', { class: 'szczegoly' },
        poz('Interesujące leady', String(p.nowy_biznes.interesujace)),
        poz('Oczekiwane tematy (bid)', String(p.nowy_biznes.oczekiwane_tematy)),
        poz('Oczekiwane wygrane', String(p.nowy_biznes.oczekiwane_wygrane)),
        poz('Oczekiwany przychód', mln(p.nowy_biznes.oczekiwany_przychod) + ' PLN'),
        poz('Oczekiwana marża', mln(p.nowy_biznes.oczekiwana_marza) + ' PLN'))),
  );
}

function kafel(etykieta, wartosc, drobne) {
  return el('div', { class: 'kafel' },
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, wartosc),
    drobne ? el('div', { class: 'drobne' }, drobne) : null);
}

function poz(et, wa) {
  return el('div', { class: 'poz' }, el('div', { class: 'et' }, et), el('div', { class: 'wa' }, wa));
}

// Lejek jako poziome paski malejace + wspolczynnik konwersji miedzy etapami
function lejek(etapy) {
  const max = Math.max(1, ...etapy.map(e => e.liczba));
  return el('div', { style: 'display:flex; flex-direction:column; gap:8px' },
    ...etapy.map((e, i) => {
      const poprz = i > 0 ? etapy[i - 1].liczba : null;
      const konw = poprz ? Math.round(100 * e.liczba / poprz) : null;
      return el('div', { style: 'display:flex; align-items:center; gap:12px' },
        el('div', { style: 'width:190px; font-size:13px; flex-shrink:0' }, e.etap),
        el('div', { style: 'flex:1; background:var(--szary-tlo); border-radius:6px; overflow:hidden; height:26px; position:relative' },
          el('div', { style: `height:100%; width:${Math.max(3, Math.round(100 * e.liczba / max))}%; background:linear-gradient(90deg, var(--granat), var(--granat-2)); display:flex; align-items:center; padding-left:8px; color:#fff; font-weight:700; font-size:13px` }, String(e.liczba))),
        el('div', { style: 'width:70px; font-size:12px; color:var(--tekst-2); text-align:right; flex-shrink:0' }, konw !== null ? `${konw}%` : ''));
    }));
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
