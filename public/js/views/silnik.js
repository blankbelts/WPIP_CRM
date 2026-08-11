// SILNIK SPRZEDAZY: graficzny model calego mechanizmu pozyskiwania wyniku.
// Zrodla -> trybiki NB (prospecting, kwalifikacja, lejek, Komitet) -> Pipeline -> wynik.
// Kazdy trybik: stan zasobu, tygodniowe zrobione/wymagane (plan wynikowy), konwersja.
// Najslabszy trybik = waskie gardlo tygodnia z szacowanym wplywem na prognoze.
import { GET } from '../api.js';
import { el, ring, badge, mln } from '../ui.js';
import { ikona } from '../ikony.js';

function kolorKondycji(k) {
  if (k == null) return 'var(--tekst-2)';
  if (k >= 1) return 'var(--zielony, #2e9e5b)';
  if (k >= 0.6) return 'var(--zolty, #d9a400)';
  return 'var(--czerwony)';
}

const IKONA_TRYBIKA = { leady: 'leady', kwalifikacja: 'scoring', lejek_nb: 'lejki', komitet: 'komitet', ofertowanie: 'pipeline' };

// Konwersja zmierzona odbiegajaca od oczekiwania (baseline) = sygnal do poprawy procesu:
// >= baseline zielona, 60-100% baseline zolta, < 60% czerwona; baseline bez pomiaru = szara
export function kolorKonwersji(k) {
  if (!k || k.zrodlo !== 'pomiar' || !k.baseline) return 'szary';
  const r = k.wartosc / k.baseline;
  if (r >= 1) return 'zielony';
  if (r >= 0.6) return 'zolty';
  return 'czerwony';
}

export async function widokSilnik(kontener) {
  const d = await GET('/silnik');

  const kartaTrybika = (t) => {
    const gardlo = d.waskie_gardlo?.klucz === t.klucz;
    const kolor = kolorKondycji(t.kondycja);
    const procent = t.kondycja == null ? null : Math.round(t.kondycja * 100);
    return el('div', {
      class: 'karta-box',
      style: `flex:1; min-width:190px; max-width:240px; padding:14px; display:flex; flex-direction:column; gap:8px; align-items:center; text-align:center;`
        + (gardlo ? 'border:2px solid var(--czerwony); box-shadow:0 0 0 3px rgba(195,24,50,.12);' : ''),
    },
      el('div', { style: 'display:flex; align-items:center; gap:6px; color:var(--tekst-2); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.4px' },
        ikona(IKONA_TRYBIKA[t.klucz] || 'info', 15), t.warstwa === 'pipeline' ? 'Pipeline' : 'New Business'),
      el('b', { style: 'font-size:14px; line-height:1.25' }, t.nazwa),
      procent == null
        ? el('div', { style: 'height:64px; display:flex; flex-direction:column; align-items:center; justify-content:center' },
          el('b', { style: 'font-size:24px' }, t.zrobione ?? 0),
          el('span', { style: 'font-size:11px; color:var(--tekst-2)' }, 'w tym tygodniu'))
        : ring(procent, 64),
      el('div', { style: 'font-size:13px' },
        procent == null
          ? el('span', { style: 'color:var(--tekst-2)' }, 'tempo dowolne — plan pokryty')
          : el('span', {},
            el('b', { style: 'color:' + kolor }, `${t.zrobione ?? '—'} / ${t.wymagane ?? '—'}`),
            el('span', { style: 'color:var(--tekst-2)' }, ' w tym tygodniu')),
        t.zaplanowane ? el('div', { style: 'font-size:12px; color:var(--tekst-2)' }, `+ ${t.zaplanowane} zaplanowanych`) : ''),
      el('div', { style: 'font-size:12px; color:var(--tekst-2)' },
        `${t.stan.liczba} ${t.stan.etykieta}`,
        t.stan.wazona != null ? ` · ważona ${mln(t.stan.wazona)}` : ''),
      t.konwersja ? el('div', { title: `oczekiwana (baseline): ${Math.round(t.konwersja.baseline * 100)}%` },
        badge(`↓ ${Math.round(t.konwersja.wartosc * 100)}%`, kolorKonwersji(t.konwersja)),
        el('span', { style: 'font-size:11px; color:var(--tekst-2); margin-left:4px' }, t.konwersja.zrodlo)) : '',
      gardlo ? el('div', { style: 'color:var(--czerwony); font-weight:700; font-size:12px; display:flex; gap:4px; align-items:center' },
        ikona('alert', 14), 'wąskie gardło') : '');
  };

  const strzalka = () => el('div', { style: 'align-self:center; color:var(--tekst-2); flex-shrink:0' }, ikona('strzalka', 22));

  // Zrodla pozyskania (wejscie silnika)
  const kartaZrodel = el('div', { class: 'karta-box', style: 'min-width:170px; max-width:200px; padding:14px; display:flex; flex-direction:column; gap:6px' },
    el('div', { style: 'display:flex; align-items:center; gap:6px; color:var(--tekst-2); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.4px' },
      ikona('import', 15), 'Źródła'),
    ...d.zrodla.slice(0, 6).map(z => el('div', { style: 'display:flex; justify-content:space-between; font-size:13px; gap:8px' },
      el('span', { style: 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, z.zrodlo),
      el('b', { title: `${z.aktywne} aktywnych · ${z.ostatnie_30d} z 30 dni` }, z.razem))),
    d.zrodla.length > 6 ? el('div', { style: 'font-size:12px; color:var(--tekst-2)' }, `+ ${d.zrodla.length - 6} innych`) : '',
    el('div', { style: 'font-size:11px; color:var(--tekst-2); margin-top:4px' }, 'liczby: wszystkie leady (najedź: aktywne / 30 dni)'));

  // Wynik (wyjscie silnika)
  const pokrycie = d.plan ? Math.round(d.projekcja / d.plan * 100) : null;
  const kartaWyniku = el('div', { class: 'karta-box', style: 'min-width:190px; max-width:240px; padding:14px; display:flex; flex-direction:column; gap:8px; align-items:center; text-align:center; border:2px solid var(--granat-2)' },
    el('div', { style: 'display:flex; align-items:center; gap:6px; color:var(--tekst-2); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.4px' },
      ikona('cel', 15), 'Wynik ' + d.okres),
    pokrycie != null ? ring(pokrycie, 64) : '',
    el('div', { style: 'font-size:13px' },
      el('div', {}, el('span', { style: 'color:var(--tekst-2)' }, 'idziemy na '), el('b', {}, mln(d.projekcja))),
      el('div', {}, el('span', { style: 'color:var(--tekst-2)' }, 'plan '), el('b', {}, mln(d.plan)))),
    d.luka > 0
      ? el('div', { style: 'color:var(--czerwony); font-weight:700; font-size:13px' }, `luka ${mln(d.luka)}`)
      : el('div', { style: 'color:var(--zielony, #2e9e5b); font-weight:700; font-size:13px' }, 'plan pokryty'),
    el('div', { style: 'font-size:12px; color:var(--tekst-2)' },
      `velocity ${d.velocity.aktualna} / potrzebna ${d.velocity.potrzebna} mln/mc`));

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Silnik sprzedaży'),
        el('p', { class: 'podtytul' },
          `Tydzień od ${d.tydzien_od} · zakontraktowane ${mln(d.wygrane.w)} + pipeline ważony ${mln(d.wazony)} = projekcja ${mln(d.projekcja)} przy planie ${mln(d.plan)}`))),
    d.waskie_gardlo ? el('div', { class: 'info-box', style: 'border-left:4px solid var(--czerwony); display:flex; gap:8px; align-items:center' },
      ikona('alert', 18),
      el('span', {},
        el('b', {}, `Wąskie gardło tygodnia: ${d.waskie_gardlo.nazwa}. `),
        `Brakuje ${d.waskie_gardlo.brak_tydzien} do tygodniowego tempa`,
        d.waskie_gardlo.wplyw_mln ? ` — każdy tydzień takiego tempa to ok. ${mln(d.waskie_gardlo.wplyw_mln)} przyszłej sprzedaży mniej.` : '.'))
      : el('div', { class: 'info-box', style: 'border-left:4px solid var(--zielony, #2e9e5b)' },
        'Wszystkie trybiki pracują w tygodniowym tempie planu.'),
    el('div', { style: 'display:flex; gap:10px; align-items:stretch; flex-wrap:wrap; margin-top:14px' },
      kartaZrodel, strzalka(),
      ...d.trybiki.flatMap((t, i) => i ? [strzalka(), kartaTrybika(t)] : [kartaTrybika(t)]),
      strzalka(), kartaWyniku),
    el('div', { class: 'info-box', style: 'margin-top:14px' },
      'Każdy trybik: pierścień = realizacja tygodniowego tempa z planu wynikowego (zrobione / wymagane), ',
      'odznaka ↓ = konwersja na wyjściu trybika. Kolor konwersji = odchylenie pomiaru od oczekiwania (baseline w dymku): ',
      'zielona ≥ baseline, żółta 60–100%, czerwona < 60%; szara = baseline bez pomiaru (za mała próba). ',
      'Najsłabszy trybik podświetlony na czerwono obniża prognozę — szczegóły liczb w kartach PDCA i Prognoza.'));
}
