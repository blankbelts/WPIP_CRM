// Karta PDCA — kontrola działań prowadzących do kamieni milowych,
// razem z metrykami pipeline (jedna karta, jedno źródło liczb).
//
// Plan  — ile zadań zaplanowano na bieżący kamień
// Do    — ile wykonano
// Check — ile kryteriów kamienia brakuje, jaka skuteczność zadań, czas vs norma
// Act   — decyzja korygująca; bez niej temat z serią porażek zostaje bez ruchu
import { GET, POST } from '../api.js';
import { el, tabela, badge, mln, dataPl, modal, pole, zbierzForm, toast } from '../ui.js';
import { ikona } from '../ikony.js';

const STAN_BADGE = { 'w normie': 'zielony', zagrozony: 'zolty', opozniony: 'czerwony', 'brak normy': 'szary' };
const STAN_OPIS = { 'w normie': 'w normie', zagrozony: 'zagrożony', opozniony: 'opóźniony', 'brak normy': 'brak normy' };

const DECYZJE = [
  ['kontynuuj', 'Kontynuuj — podejście działa, potrzeba czasu'],
  ['zmien_podejscie', 'Zmień podejście — to, co robimy, nie przynosi efektu'],
  ['eskaluj', 'Eskaluj — potrzebny zarząd / wyższy poziom relacji'],
  ['zamknij', 'Zamknij — temat nie rokuje'],
];

export async function widokPdca(kontener) {
  const [d, pw] = await Promise.all([GET('/pdca'), GET('/plan-wynikowy')]);
  const odswiez = () => widokPdca((kontener.innerHTML = '', kontener));
  const p = d.podsumowanie;

  kontener.append(
    el('h1', {}, 'PDCA i metryki pipeline'),
    el('p', { class: 'podtytul' },
      'Kamień milowy to fakt po stronie klienta. Ta karta pokazuje, na jaki wynik idziemy przy ' +
      'aktualnych postępach, ile do niego brakuje i gdzie powtarzamy podejście, które nie działa.'),

    sekcjaNaCoIdziemy(pw, odswiez),

    el('div', { class: 'kafle' },
      kafel('Tematy otwarte', String(p.otwarte), null, 'pipeline', 'nieb'),
      kafel('W normie', String(p.w_normie), 'czas w etapie poniżej normy', 'check', 'ziel'),
      kafel('Zagrożone', String(p.zagrozone), 'powyżej 80% normy etapu', 'zegar', 'zol'),
      kafel('Opóźnione', String(p.opoznione), `łącznie ${p.suma_opoznienia_dni} dni ponad normę`, 'alert', 'czer'),
      kafel('Czekają na decyzję', String(p.wymaga_decyzji), 'seria działań bez efektu', 'pdca', 'zol'),
      kafel('Brakujące kryteria', String(p.brakujacych_kryteriow), 'suma po wszystkich tematach', 'scoring')),

    sekcjaSciezki(d.sciezki),
    sekcjaLeady(d.leady),
    sekcjaTematy(d.tematy, odswiez),
    sekcjaCheckPipeline(d.metryki),
    sekcjaDecyzje(d.decyzje),
  );
}

// ── Kontrola tygodniowa: na jaki wynik idziemy + odwrocony lejek z konwersji ──
function sekcjaNaCoIdziemy(pw, odswiez) {
  const naPlanie = pw.projekcja >= pw.plan_firmowy;
  const zrodloBadge = (k) => badge(k.zrodlo === 'pomiar' ? `${Math.round(k.wartosc * 100)}%` : `~${Math.round(k.wartosc * 100)}%`,
    k.zrodlo === 'pomiar' ? 'nieb' : 'szary');

  return el('div', { class: 'karta-box', style: 'border-left: 4px solid ' + (naPlanie ? 'var(--zielony)' : 'var(--akcent)') },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0' }, ikona('cel'), ' Na co idziemy — ', pw.okres,
        ' ', badge(`${pw.tygodnie_pozostale} tyg. do końca`, 'szary')),
      el('button', {
        class: 'btn btn-maly', onclick: () => {
          const input = el('input', { type: 'number', value: pw.plan_firmowy, style: 'max-width:140px' });
          modal('Plan sprzedaży firmy (' + pw.okres + ')', el('div', { class: 'pole' },
            el('label', {}, 'Plan (mln PLN) — wartość podpisanych umów'), input),
            [['Zapisz', 'btn-glowny', async () => {
              await (await import('../api.js')).PUT('/plan-wynikowy', { rok: pw.okres, plan: Number(input.value) });
              toast('Plan zapisany'); odswiez();
            }]]);
        }
      }, 'Zmień plan')),

    el('div', { class: 'kafle' },
      kafel('Plan sprzedaży', mln(pw.plan_firmowy) + ' PLN', 'wartość podpisanych umów', 'cel'),
      kafel('Projekcja („idziemy na")', mln(pw.projekcja) + ' PLN',
        `wygrane ${mln(pw.wygrane.w)} + ważony pipeline ${mln(pw.wazony)}`, 'prognoza', naPlanie ? 'ziel' : 'zol'),
      kafel('Luka do planu', mln(pw.luka) + ' PLN', naPlanie ? 'plan pokryty projekcją' : `≈ ${Math.ceil(pw.luka / pw.sr_wartosc_wygranej)} wygranych po śr. ${mln(pw.sr_wartosc_wygranej)}`, 'alert', naPlanie ? 'ziel' : 'czer'),
      kafel('Velocity: jest / trzeba', `${pw.velocity.aktualna ?? '—'} / ${pw.velocity.potrzebna}`,
        'mln PLN miesięcznie', 'waga', (pw.velocity.aktualna || 0) >= pw.velocity.potrzebna ? 'ziel' : 'czer'),
      kafel('Działania / tydzień', String(pw.dzialania.tygodniowo),
        `${pw.dzialania.potrzeba} łącznie · śr. ${pw.dzialania.srednio_na_wygrana} działań na wygraną`, 'dzialania', 'nieb')),

    // Odwrocony lejek: ile potrzeba na kazdym poziomie
    el('h2', { style: 'font-size:14px' }, 'Ile potrzeba, żeby domknąć lukę (z konwersji między etapami)'),
    tabela([
      { naglowek: 'Poziom', render: w => el('b', {}, w.poziom) },
      { naglowek: 'Konwersja niżej', klasa: 'wysrodkuj', render: w => w.konwersja ? zrodloBadge(w.konwersja) : '—' },
      { naglowek: 'Potrzeba w okresie', klasa: 'liczba', render: w => String(w.potrzeba) },
      { naglowek: 'Tygodniowo', klasa: 'liczba', render: w => el('b', {}, String(w.tygodniowo)) },
      { naglowek: 'Jest teraz', klasa: 'liczba', render: w => String(w.jest) },
      {
        naglowek: 'Bilans', klasa: 'wysrodkuj', render: w => w.jest >= w.potrzeba
          ? badge('✓ pokryte', 'zielony') : badge(`brakuje ${w.potrzeba - w.jest}`, 'czerwony')
      },
    ], pw.lejek_odwrocony),
    el('p', { class: 'podtytul', style: 'margin:8px 0 0; font-size:12px' },
      'Konwersje: niebieskie = zmierzone z danych CRM, szare (~) = baseline do czasu zebrania próby. „Jest teraz" dla leadów/tematów = otwarte w toku; dla komitetów/wygranych = zrealizowane w okresie.'),

    // Per handlowiec
    pw.handlowcy.length ? el('div', {},
      el('h2', { style: 'font-size:14px' }, 'Per handlowiec (plan sprzedaży z celów rocznych)'),
      tabela([
        { naglowek: 'Handlowiec', render: h => el('b', {}, h.handlowiec) },
        { naglowek: 'Plan', klasa: 'liczba', render: h => mln(h.plan) },
        { naglowek: 'Wygrane', klasa: 'liczba', render: h => `${mln(h.wygrane_wartosc)} (${h.wygrane_n})` },
        { naglowek: 'Ważony pipeline', klasa: 'liczba', render: h => `${mln(h.wazony)} (${h.tematy_otwarte} tem.)` },
        { naglowek: 'Projekcja', klasa: 'liczba', render: h => el('b', {}, mln(h.projekcja)) },
        {
          naglowek: 'Luka', klasa: 'liczba', render: h => h.luka <= 0
            ? badge('✓ plan', 'zielony') : el('span', { style: 'color:var(--czerwony); font-weight:700' }, mln(h.luka))
        },
        { naglowek: 'Brak. wygranych', klasa: 'liczba', render: h => String(h.potrzebne_wygrane) },
        { naglowek: 'Leady / tydz.', klasa: 'liczba', render: h => String(h.potrzebne_leady_tydz) },
        { naglowek: 'Działania / tydz.', klasa: 'liczba', render: h => el('b', {}, String(h.potrzebne_dzialania_tydz)) },
      ], pw.handlowcy)) : '');
}

// ── PLAN: ścieżki procesu i ich normy czasu ──────────────────────────────────
function sekcjaSciezki(sciezki) {
  return el('div', { class: 'karta-box' },
    el('h2', { style: 'margin-top:0' }, 'Ścieżki procesu i normy czasu'),
    el('div', { class: 'info-box' },
      'Proces rozdzielony wg etapu projektu inwestora. Inwestor z projektem i pozwoleniem wybiera ' +
      'wykonawcę w około pół roku; przy pracy od koncepcji dochodzą koncepcja, projekt i pozwolenie — stąd 12–18 miesięcy.'),
    el('div', { style: 'display:flex; flex-direction:column; gap:16px' },
      ...sciezki.map(s => el('div', { style: 'border:1px solid var(--linia); border-radius:10px; padding:12px 14px' },
        el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap' },
          el('div', {}, el('b', {}, s.nazwa), s.persona ? el('span', { style: 'color:var(--tekst-2); font-size:12px' }, ' · ' + s.persona) : ''),
          el('div', { style: 'display:flex; gap:8px; align-items:center' },
            badge(`${s.kamieni} kamieni`, 'szary'),
            badge(s.norma_mies ? `norma ${s.norma_mies} mc` : 'brak normy', 'nieb'),
            badge(`${s.tematy} tematów`, s.tematy ? 'zielony' : 'szary'))),
        pasekEtapow(s.kamienie)))));
}

/** Poglądowy pasek: szerokość segmentu = udział normy etapu w całej ścieżce. */
function pasekEtapow(kamienie) {
  const suma = kamienie.reduce((s, k) => s + (k.czas_typowy_dni || 0), 0) || 1;
  return el('div', { style: 'margin-top:10px' },
    el('div', { style: 'display:flex; height:22px; border-radius:6px; overflow:hidden; border:1px solid var(--linia)' },
      ...kamienie.filter(k => k.czas_typowy_dni).map((k, i) => el('div', {
        class: 'wykres-tooltip',
        style: `flex:${k.czas_typowy_dni} 0 0; background:${i % 2 ? '#3d6fd0' : '#5b8ae6'}; position:relative; ` +
          'display:flex; align-items:center; justify-content:center; color:#fff; font-size:10px; font-weight:700',
      }, k.kod, el('div', { class: 'tip' }, `${k.kod} — ${k.nazwa} · norma ${k.czas_typowy_dni} dni`)))),
    el('div', { class: 'legenda', style: 'margin-top:4px' },
      el('span', {}, `razem ${suma} dni`),
      el('span', {}, 'szerokość segmentu = udział etapu w normie cyklu')));
}

// ── Kwalifikacja leadów: norma dwóch tygodni ─────────────────────────────────
function sekcjaLeady(l) {
  return el('div', { class: 'karta-box' },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0' }, 'Kwalifikacja leadów'),
      el('span', { style: 'color:var(--tekst-2); font-size:12px' },
        `norma ${l.norma_calkowita_dni} dni od leada surowego do zakwalifikowanego`)),
    el('div', { class: 'kafle' },
      kafel('W kwalifikacji', String(l.w_kwalifikacji), null, 'leady', 'nieb'),
      kafel('Po normie', String(l.po_normie), 'dłużej niż norma etapu', 'zegar', l.po_normie ? 'zol' : '')),
    l.lista.length ? tabela([
      { naglowek: 'Lead', render: x => el('a', { class: 'link', href: '#/leady/' + x.id }, x.nazwa) },
      { naglowek: 'Klient', render: x => x.klient_nazwa || '—' },
      { naglowek: 'Etap', render: x => badge(x.kamien || '—', 'nieb') },
      { naglowek: 'Prio', klasa: 'wysrodkuj', render: x => badge(x.priorytet || 'D', 'szary') },
      { naglowek: 'Wiek', klasa: 'liczba', render: x => `${x.wiek_dni} dni` },
      { naglowek: 'Norma', klasa: 'liczba', render: x => `${x.norma_dni} dni` },
      {
        naglowek: 'Stan', klasa: 'wysrodkuj',
        render: x => badge(x.po_normie ? `+${x.wiek_dni - x.norma_dni} dni` : 'w normie', x.po_normie ? 'czerwony' : 'zielony'),
      },
    ], l.lista) : el('div', { class: 'puste' }, 'Brak aktywnych leadów w kwalifikacji'));
}

// ── PDCA per temat ───────────────────────────────────────────────────────────
function sekcjaTematy(tematy, odswiez) {
  if (!tematy.length) return el('div', { class: 'karta-box puste' }, 'Brak otwartych tematów');

  // Najpierw to, co się pali: wymagające decyzji, potem opóźnione, potem reszta
  const waga = t => (t.pdca.wymaga_decyzji ? 0 : 1) * 10 +
    ({ opozniony: 0, zagrozony: 1, 'w normie': 2, 'brak normy': 3 }[t.pdca.czas.stan] ?? 3);
  const posortowane = [...tematy].sort((a, b) => waga(a) - waga(b));

  return el('div', { class: 'karta-box' },
    el('h2', { style: 'margin-top:0' }, 'Kontrola tematów (', String(tematy.length), ')'),
    el('div', { class: 'info-box' },
      'Kolejność wg pilności: najpierw tematy z serią działań bez efektu, potem opóźnione. ' +
      'Kolumna „brakuje" to niespełnione kryteria bieżącego kamienia — dokładnie to, co dzieli temat od awansu.'),
    el('div', { style: 'display:flex; flex-direction:column; gap:10px' },
      ...posortowane.map(t => kartaTematu(t, odswiez))));
}

function kartaTematu(t, odswiez) {
  const c = t.pdca.check;
  const czas = t.pdca.czas;
  const skutecznosc = c.skutecznosc;

  return el('div', {
    style: 'border:1px solid var(--linia); border-left:3px solid ' +
      (czas.stan === 'opozniony' ? 'var(--czerwony)' : czas.stan === 'zagrozony' ? 'var(--zolty)' : 'var(--linia)') +
      '; border-radius:8px; padding:10px 12px',
  },
    // Nagłówek tematu
    el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap' },
      el('div', {},
        el('a', { class: 'link', href: '#/tematy/' + t.id }, el('b', {}, t.identyfikator)),
        el('span', { style: 'color:var(--tekst-2); font-size:13px' }, t.klient_nazwa ? ' · ' + t.klient_nazwa : ''),
        el('div', { style: 'font-size:12px; color:var(--tekst-2); margin-top:2px' },
          badge(t.pipeline_kod || '—', 'szary'), ' ',
          badge(t.kamien_kod || '—', 'akcent'), ' ', t.kamien_nazwa || '')),
      el('div', { style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap' },
        t.pdca.wymaga_decyzji ? badge('wymaga decyzji', 'czerwony') : '',
        t.pdca.gotowy ? badge('kamień gotowy do potwierdzenia', 'zielony') : '',
        t.bez_planu ? badge('brak zaplanowanego działania', 'zolty') : '',
        el('button', { class: 'btn btn-maly', onclick: () => formularzDecyzji(t, odswiez) },
          ikona('pdca', 13), ' Decyzja'))),

    // Cztery fazy
    el('div', { style: 'display:flex; gap:18px; flex-wrap:wrap; margin-top:10px; font-size:12px' },
      faza('Plan', `${t.pdca.plan} zadań`, t.pdca.plan ? '' : 'brak'),
      faza('Do', `${t.pdca.do} wykonanych`, ''),
      faza('Check', c.kryteria_razem ? `${c.kryteria_spelnione}/${c.kryteria_razem} kryteriów` : 'brak kryteriów',
        skutecznosc === null ? '' : `skuteczność ${skutecznosc}%`),
      faza('Act', t.pdca.act ? opisDecyzji(t.pdca.act.decyzja) : '—',
        t.pdca.act ? dataPl(t.pdca.act.data) : 'bez decyzji'),
      faza('Czas', czas.norma ? `${czas.dni} / ${czas.norma} dni` : `${czas.dni} dni`,
        STAN_OPIS[czas.stan], STAN_BADGE[czas.stan]),
      faza('Prognoza', t.prognoza.data ? dataPl(t.prognoza.data) : '—',
        t.prognoza.dni != null ? `za ${t.prognoza.dni} dni` : ''),
      faza('Wartość', mln(t.wartosc_kontraktu), `${t.prawdopodobienstwo}% szans`)),

    // Czego dokładnie brakuje
    c.brakujace.length ? el('div', { style: 'margin-top:8px; font-size:12px; color:var(--tekst-2)' },
      el('b', {}, 'Brakuje: '),
      c.brakujace.join(' · ')) : '',
    c.nieosiagniete >= 2 ? el('div', { style: 'margin-top:6px; font-size:12px; color:var(--czerwony)' },
      `${c.nieosiagniete} działania zakończone bez efektu — to sygnał, że warto zmienić podejście, a nie powtarzać.`) : '');
}

function faza(nazwa, wartosc, drobne, badgeKlasa) {
  return el('div', {},
    el('div', { style: 'font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:var(--tekst-2)' }, nazwa),
    el('div', { style: 'font-weight:600' }, wartosc),
    drobne ? (badgeKlasa ? badge(drobne, badgeKlasa)
      : el('div', { style: 'font-size:11px; color:var(--tekst-2)' }, drobne)) : '');
}

const opisDecyzji = (kod) => (DECYZJE.find(d => d[0] === kod)?.[1] || kod).split(' — ')[0];

function formularzDecyzji(t, odswiez) {
  const c = t.pdca.check;
  const kontekst = el('div', { class: 'info-box', style: 'margin-bottom:12px' },
    el('div', {}, el('b', {}, t.kamien_kod + ' — '), t.kamien_nazwa),
    c.brakujace.length ? el('div', { style: 'margin-top:4px' }, 'Brakuje: ' + c.brakujace.join(' · ')) : '',
    el('div', { style: 'margin-top:4px' },
      `Czas w etapie: ${t.pdca.czas.dni} dni` + (t.pdca.czas.norma ? ` przy normie ${t.pdca.czas.norma}` : '') +
      ` · działania: ${t.pdca.do} wykonane, ${c.osiagniete} z efektem, ${c.nieosiagniete} bez`));

  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'decyzja', label: 'Decyzja', typ: 'select', opcje: DECYZJE, wymagane: true, szerokie: true }),
    pole({ name: 'diagnoza', label: 'Co blokuje kamień', typ: 'textarea', szerokie: true }),
    pole({ name: 'uzasadnienie', label: 'Uzasadnienie decyzji', typ: 'textarea', szerokie: true }),
    el('div', { class: 'info-box', style: 'grid-column:1/-1' },
      'Poniżej możesz od razu zaplanować następne działanie — temat nie zostanie bez kolejnego kroku.'),
    pole({ name: 'cel', label: 'Następne działanie (cel = rezultat od klienta)', szerokie: true }),
    pole({ name: 'typ', label: 'Typ', typ: 'select', opcje: ['telefon', 'mail', 'spotkanie', 'wizyta', 'warsztat', 'research', 'inne'] }),
    pole({ name: 'termin', label: 'Termin', typ: 'date' }));

  modal('Decyzja PDCA — ' + t.identyfikator, el('div', {}, kontekst, form), [['Zapisz decyzję', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.decyzja) { toast('Wybierz decyzję', true); return false; }
    try {
      await POST(`/tematy/${t.id}/pdca-decyzja`, {
        decyzja: d.decyzja, diagnoza: d.diagnoza, uzasadnienie: d.uzasadnienie,
        dzialanie: d.cel ? { cel: d.cel, typ: d.typ, termin: d.termin } : null,
      });
      toast('Decyzja zapisana' + (d.cel ? ' — działanie dodane do roadmapy' : ''));
      odswiez();
    } catch (e) { toast(e.message, true); return false; }
  }]]);
}

// ── CHECK na poziomie pipeline (dawne Metryki) ───────────────────────────────
function sekcjaCheckPipeline(m) {
  return el('div', {},
    el('h2', {}, 'Check — poziom pipeline'),
    el('div', { class: 'kafle' },
      kafel('Sales velocity', m.velocity.mln_na_miesiac === null ? '—' : `${m.velocity.mln_na_miesiac} mln/mc`,
        `${m.velocity.otwarte} otwartych × ${m.velocity.sr_wartosc} mln śr. × ${m.velocity.win_rate_pct}% win / ${m.velocity.sr_cykl_dni} dni cyklu` +
        (m.velocity.fallback ? ' (część założeń z baseline 2025)' : '')),
      kafel('Konta AM z planem opieki', m.am_coverage.pokrycie_pct === null ? '—' : m.am_coverage.pokrycie_pct + '%',
        `${m.am_coverage.z_planem} / ${m.am_coverage.konta} kont powracających`),
      kafel('Przeglądy zaległe', String(m.am_coverage.zalegle), 'konta z datą przeglądu w przeszłości')),

    ...(m.lejek.length ? m.lejek.map(pl => el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Konwersja między kamieniami — ', pl.pipeline),
      lejekKonwersji(pl.etapy)))
      : [el('div', { class: 'karta-box puste' }, 'Brak danych o przejściach kamieni — pojawią się, gdy tematy zaczną awansować')]),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Powody utraty per etap'),
      m.utrata.length ? tabela([
        { naglowek: 'Kamień', klasa: 'wysrodkuj', render: u => badge(u.kamien_kod || '—', 'nieb') },
        { naglowek: 'Powód', render: u => u.powod || '— brak kodu —' },
        { naglowek: 'Status', render: u => badge(u.status, u.status === 'recycled' ? 'zolty' : 'czerwony') },
        { naglowek: 'Liczba', klasa: 'liczba', render: u => String(u.c) },
      ], m.utrata) : el('div', { class: 'puste' }, 'Brak zamkniętych tematów')),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Skuteczność typów zadań'),
      el('div', { class: 'info-box' }, 'Które typy działań najczęściej kończą się efektem osiągniętym — podpowiedź, w co inwestować czas.'),
      m.zadania.length ? el('div', { style: 'display:flex; flex-direction:column; gap:8px' },
        ...m.zadania.map(z => el('div', { style: 'display:flex; align-items:center; gap:12px' },
          el('div', { style: 'width:160px; font-size:13px' }, z.typ),
          el('div', { class: 'wykres-tooltip', style: 'flex:1; background:var(--szary-tlo); border-radius:6px; height:20px; position:relative' },
            el('div', { class: 'slupek-h', style: `height:100%; width:${z.skutecznosc || 0}%; background:#3d6fd0; min-width:2px` }),
            el('div', { class: 'tip' }, `${z.typ}: ${z.osiagniete} z ${z.total} zadań z efektem osiągniętym`)),
          el('div', { style: 'width:120px; font-size:12px; color:var(--tekst-2); text-align:right' },
            `${z.skutecznosc ?? 0}% (${z.osiagniete}/${z.total})`))))
        : el('div', { class: 'puste' }, 'Brak wykonanych zadań z zapisanym wynikiem')));
}

function lejekKonwersji(etapy) {
  const max = Math.max(1, ...etapy.map(e => e.liczba));
  return el('div', { style: 'display:flex; flex-direction:column; gap:6px' },
    ...etapy.map(e => el('div', { style: 'display:flex; align-items:center; gap:12px' },
      el('div', { style: 'width:60px; font-weight:700' }, e.kod),
      el('div', { class: 'wykres-tooltip', style: 'flex:1; background:var(--szary-tlo); border-radius:6px; height:24px; overflow:visible; position:relative' },
        el('div', { class: 'slupek-h', style: `height:100%; width:${Math.max(3, Math.round(100 * e.liczba / max))}%; background:#3d6fd0` }),
        el('div', { class: 'tip' }, `${e.kod}: ${e.liczba} tematów` + (e.konwersja !== null ? ` · konwersja ${e.konwersja}%` : '') + (e.mediana_dni !== null ? ` · mediana ${e.mediana_dni} dni` : ''))),
      el('div', { style: 'width:40px; font-size:12px; font-weight:700; text-align:right' }, String(e.liczba)),
      el('div', { style: 'width:60px; font-size:12px; color:var(--tekst-2); text-align:right' }, e.konwersja !== null ? `${e.konwersja}%` : ''),
      el('div', { style: 'width:90px; font-size:12px; color:var(--tekst-2); text-align:right' }, e.mediana_dni !== null ? `~${e.mediana_dni} dni` : '—'))),
    el('div', { class: 'legenda', style: 'margin-top:6px' },
      el('span', {}, 'słupek = liczba tematów, które weszły w etap'),
      el('span', {}, '% = konwersja z poprzedniego'),
      el('span', {}, '~dni = mediana czasu w etapie')));
}

// ── ACT: ślad decyzji ────────────────────────────────────────────────────────
function sekcjaDecyzje(decyzje) {
  return el('div', { class: 'karta-box' },
    el('h2', { style: 'margin-top:0' }, 'Ostatnie decyzje korygujące'),
    decyzje.length ? tabela([
      { naglowek: 'Data', render: d => dataPl(d.data) },
      { naglowek: 'Temat', render: d => el('a', { class: 'link', href: '#/tematy/' + d.temat_id }, d.identyfikator || '—') },
      { naglowek: 'Kamień', klasa: 'wysrodkuj', render: d => badge(d.kamien_kod || '—', 'nieb') },
      { naglowek: 'Decyzja', render: d => badge(opisDecyzji(d.decyzja), d.decyzja === 'zamknij' ? 'czerwony' : d.decyzja === 'kontynuuj' ? 'zielony' : 'zolty') },
      { naglowek: 'Diagnoza', render: d => d.diagnoza || '—' },
      { naglowek: 'Kto', render: d => d.kto || '—' },
    ], decyzje) : el('div', { class: 'puste' },
      'Brak decyzji. Zapisuj je, gdy działania nie przynoszą efektu — inaczej temat stoi, a nikt nie wie dlaczego.'));
}

function kafel(etykieta, wartosc, drobne, ikonaNazwa, odcien = '') {
  return el('div', { class: 'kafel' },
    ikonaNazwa ? el('div', { class: 'ikona-tlo ' + odcien }, ikona(ikonaNazwa, 18)) : null,
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, wartosc),
    drobne ? el('div', { class: 'drobne' }, drobne) : null);
}
