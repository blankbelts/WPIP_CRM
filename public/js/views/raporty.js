// Raport win/loss dla przegladu okresowego Dyr. Sprzedazy + Marketing (cykl 4-6 tyg.)
// Rozklad przyczyn: wygrane, przegrane, odpuszczenia przedkomitetowe, NO-BID Komitetu
import { GET } from '../api.js';
import { el, tabela, mln, badge } from '../ui.js';

export async function widokRaporty(kontener) {
  const r = await GET('/raporty/win-loss');

  const rozklad = (tytul, dane, kolor) => el('div', { class: 'karta-box' },
    el('h2', { style: 'margin-top:0' }, tytul),
    dane.length && dane.some(x => x.c) ? el('table', {}, el('tbody', {},
      ...dane.map(x => el('tr', {},
        el('td', {}, x.przyczyna || x.powod || '— brak kodu —'),
        el('td', { class: 'liczba' }, badge(String(x.c), kolor))))))
      : el('div', { class: 'puste' }, 'Brak danych'));

  kontener.append(
    el('h1', {}, 'Raport win/loss'),
    el('p', { class: 'podtytul' }, 'Przegląd okresowy Dyrektora Sprzedaży + Marketing — przyczyny odrzuceń i przegranych zasilają scoring i prospecting'),

    el('div', { class: 'kafle' },
      kafel('Win rate', r.win_rate === null ? '—' : r.win_rate + '%', 'wygrane / (wygrane + przegrane)'),
      kafel('Wygrane', String(r.wygrane.reduce((s, x) => s + x.c, 0))),
      kafel('Przegrane', String(r.przegrane.reduce((s, x) => s + x.c, 0))),
      kafel('Odpuszczone leady', String(r.odpuszczone_leady.reduce((s, x) => s + x.c, 0)), 'przedkomitetowo'),
      kafel('NO-BID Komitetu', String(r.no_bid.reduce((s, x) => s + x.c, 0)), 'pokomitetowo')),

    el('div', { style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(280px,1fr)); gap:16px; align-items:start' },
      rozklad('Przyczyny wygranych', r.wygrane, 'zielony'),
      rozklad('Przyczyny przegranych', r.przegrane, 'czerwony'),
      rozklad('Powody odpuszczeń (przedkomitetowo)', r.odpuszczone_leady, 'szary'),
      rozklad('Powody NO-BID (Komitet)', r.no_bid, 'zolty')),

    el('h2', {}, 'Zamknięte tematy'),
    tabela([
      { naglowek: 'ID tematu', render: t => t.identyfikator || '—' },
      { naglowek: 'Nazwa', render: t => t.nazwa || '—' },
      { naglowek: 'Wynik', render: t => badge(t.status, t.status === 'wygrany' ? 'zielony' : 'czerwony') },
      { naglowek: 'Przyczyna', render: t => t.przyczyna_zamkniecia || '—' },
      { naglowek: 'Wartość', klasa: 'liczba', render: t => t.wartosc_kontraktu ? mln(t.wartosc_kontraktu) : '—' },
      { naglowek: 'Kontekst', render: t => (t.przyczyna_opis || '—').slice(0, 50) },
    ], r.lista));
}

function kafel(etykieta, wartosc, drobne) {
  return el('div', { class: 'kafel' },
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, wartosc),
    drobne ? el('div', { class: 'drobne' }, drobne) : null);
}
