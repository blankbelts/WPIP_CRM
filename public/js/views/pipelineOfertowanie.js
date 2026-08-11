// WARSTWA 1 "PIPELINE": funkcjonalny zamiennik arkusza "Pipeline i kluczowe dzialania".
// Tylko tematy PO pozytywnym Komitecie (w ofertowaniu). Proste kolumny, czytelne z zewnatrz.
// % wygranej steruja kamienie milowe + efekty dzialan (silnik potwierdzen) - nie reczne wpisy.
import { GET } from '../api.js';
import { el, tabela, badge, mln, pct, dataPl, awatar, segmenty } from '../ui.js';

const STAN_BADGE = { 'w normie': 'zielony', zagrozony: 'zolty', opozniony: 'czerwony', 'brak normy': 'szary' };

export async function widokPipelineOfertowanie(kontener) {
  const d = await GET('/pipeline-ofertowanie');

  let filtrHandlowiec = '';
  const handlowcy = [...new Set(d.tematy.map(t => t.handlowiec).filter(Boolean))].sort();
  const box = el('div');

  function rysuj() {
    const tematy = d.tematy.filter(t => !filtrHandlowiec || t.handlowiec === filtrHandlowiec);
    box.innerHTML = '';
    box.append(tematy.length ? tabela([
      { naglowek: 'Temat / inwestor', render: t => el('div', {},
        el('b', {}, t.identyfikator),
        el('div', { style: 'font-size:12px; color:var(--tekst-2)' }, t.klient_nazwa || '—')) },
      { naglowek: 'Handlowiec', klasa: 'wysrodkuj', render: t => t.handlowiec ? awatar(t.handlowiec) : '—' },
      { naglowek: 'Wartość', klasa: 'liczba', render: t => el('b', {}, t.wartosc_kontraktu ? mln(t.wartosc_kontraktu) : '—') },
      { naglowek: 'Marża', klasa: 'liczba', render: t => t.marza_mln != null ? `${mln(t.marza_mln)} (${t.marza_pct}%)` : '—' },
      { naglowek: '% wygranej', klasa: 'wysrodkuj', render: t => el('div', { style: 'min-width:70px' },
        el('b', {}, pct(t.prawdopodobienstwo)),
        segmenty(t.kamien_kolejnosc - 1, t.kamien_kolejnosc - 1, t.kamieni_lacznie || 9)) },
      { naglowek: 'Etap', klasa: 'wysrodkuj', render: t => el('span', { title: t.kamien_nazwa }, badge(t.kamien_kod || '—', 'nieb')) },
      { naglowek: 'Czas', klasa: 'wysrodkuj', render: t => el('span', { title: t.stan_czasu.norma ? `${t.dni_w_etapie} dni / norma ${t.stan_czasu.norma}` : '' },
        badge(`${t.dni_w_etapie} dn`, STAN_BADGE[t.stan_czasu.stan] || 'szary')) },
      { naglowek: 'Prognoza podpisania', klasa: 'wysrodkuj', render: t => t.prognoza?.data ? dataPl(t.prognoza.data) : '—' },
      { naglowek: 'Oferta / realizacja', render: t => `${t.termin_oferty ? dataPl(t.termin_oferty) : '—'} / ${t.termin_realizacji ? dataPl(t.termin_realizacji) : '—'}` },
      { naglowek: 'Kluczowe działanie', render: t => t.najblizsze_dzialanie
        ? el('span', {}, (t.najblizsze_dzialanie || '').slice(0, 45), t.najblizszy_termin ? el('span', { style: 'color:var(--tekst-2)' }, ` · ${dataPl(t.najblizszy_termin)}`) : '')
        : el('span', { style: 'color:var(--czerwony); font-weight:600' }, 'brak — zaplanuj!') },
    ], tematy, t => location.hash = '#/tematy/' + t.id)
      : el('div', { class: 'karta-box puste' }, 'Brak tematów w ofertowaniu. Tematy trafiają tu po pozytywnej decyzji Komitetu Ofertowego (BID).'));
  }
  rysuj();

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Pipeline'),
        el('p', { class: 'podtytul' },
          `Tematy w ofertowaniu (po pozytywnym Komitecie): ${d.tematy.length} · wartość ${mln(d.suma)} PLN · ważona ${mln(d.wazona)} PLN`)),
      el('div', { class: 'filtry', style: 'margin:0' },
        el('select', { onchange: e => { filtrHandlowiec = e.target.value; rysuj(); } },
          el('option', { value: '' }, 'Handlowiec: wszyscy'),
          ...handlowcy.map(h => el('option', { value: h }, h))))),
    el('div', { class: 'info-box' },
      'Warstwa podstawowa — zamiennik arkusza. Prawdopodobieństwem sterują potwierdzone kamienie milowe i efekty działań (klik w wiersz → pełna karta tematu). Praca nad tematami przed Komitetem: sekcja New Business.'),
    box);
}
