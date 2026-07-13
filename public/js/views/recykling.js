// Pula recyklingu: tematy zamkniete z powodem recyklingowalnym, wracaja automatycznie w dacie powrotu.
import { GET } from '../api.js';
import { el, tabela, dataPl, mln, badge } from '../ui.js';

export async function widokRecykling(kontener) {
  const lista = await GET('/recykling');

  kontener.append(
    el('h1', {}, 'Pula recyklingu'),
    el('p', { class: 'podtytul' }, 'Tematy zamknięte z powodem recyklingowalnym nie znikają — wracają automatycznie w dacie powrotu z zadaniem follow-up. Leady „na później", nie stracone.'),

    lista.length ? tabela([
      { naglowek: 'Data powrotu', render: t => el('b', { style: new Date(t.recycle_date) <= new Date() ? 'color:var(--akcent)' : '' }, dataPl(t.recycle_date)) },
      { naglowek: 'Identyfikator', render: t => t.identyfikator },
      { naglowek: 'Klient', render: t => t.klient_nazwa || '—' },
      { naglowek: 'Kamień', render: t => badge(t.kamien_kod || '—', 'nieb') },
      { naglowek: 'Powód', render: t => t.przyczyna_zamkniecia || '—' },
      { naglowek: 'Wartość', klasa: 'liczba', render: t => t.wartosc_kontraktu ? mln(t.wartosc_kontraktu) : '—' },
    ], lista, t => location.hash = '#/tematy/' + t.id)
      : el('div', { class: 'karta-box puste' }, 'Pula recyklingu jest pusta. Tematy trafią tu po zamknięciu z powodem recyklingowalnym (np. „plany >24 mc").'));
}
