// Roadmapa tygodnia handlowca + pulpit postepow (widok startowy).
// Zadania tygodnia pogrupowane per temat, z oczekiwanym efektem i podpowiedzia "co dalej".
// Regula "zawsze nastepny krok": tematy bez otwartego zadania sa wyroznione.
import { GET, POST, PUT, DEL } from '../api.js';
import { el, toast, mln, badge, dataPl, modal, pole, zbierzForm, ring, awatar, tabela } from '../ui.js';
import { ikona, IKONA_TYPU_DZIALANIA } from '../ikony.js';

export async function widokRoadmapa(kontener) {
  const [r, cele, pw] = await Promise.all([GET('/roadmapa'), GET('/cele/postep'), GET('/plan-wynikowy')]);
  const odswiez = () => widokRoadmapa((kontener.innerHTML = '', kontener));

  // Grupowanie zadan per temat/lead
  const grupy = {};
  for (const z of r.zadania) {
    const klucz = z.temat_identyfikator || z.lead_nazwa || 'Inne';
    (grupy[klucz] ||= { naglowek: klucz, klient: z.klient_nazwa, temat_id: z.t_id, lead_id: z.lead_id, zadania: [] }).zadania.push(z);
  }

  kontener.append(
    el('h1', {}, 'Roadmapa tygodnia'),
    el('p', { class: 'podtytul' }, 'Twoje zadania na ten tydzień — każde ma oczekiwany efekt i podpowiedź kolejnego kroku. Kamień milowy to fakt po stronie klienta; zadania zwiększają szansę jego osiągnięcia.'),

    // --- Pulpit postepow ---
    el('div', { class: 'kafle' },
      kafel('Tematy otwarte', String(r.postep.tematy_otwarte), null, 'pipeline', 'nieb'),
      kafel('Wartość ważona', mln(r.postep.wartosc_wazona) + ' PLN', 'suma wartość × prawdopodobieństwo', 'waga'),
      kafel('Zastygłe', String(r.postep.liczba_zastygle), 'przekroczony próg czasu w etapie', 'zegar', 'zol'),
      kafel('Bez ruchu', String(r.postep.liczba_bez_ruchu), 'brak otwartego zadania', 'alert', 'zol'),
      kafel('Opóźnione', String(r.postep.liczba_opoznione ?? 0), 'ponad normę czasu etapu', 'zegar', 'czer'),
      kafel('Wymaga decyzji', String(r.postep.liczba_wymaga_decyzji ?? 0), 'seria działań bez efektu — karta PDCA', 'pdca', 'zol'),
      kafel('Recykling', String(r.postep.recykling), 'w puli powrotów', 'recykling', 'ziel')),

    // --- Tydzien vs plan sprzedazy + stan projekcji (z silnika planu wynikowego) ---
    sekcjaTydzienVsPlan(pw),

    // --- Postep w planach (cele sprzedazowe per handlowiec) ---
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, '🎯 Postęp w planach (cele sprzedażowe)'),
        el('button', { class: 'btn btn-maly', onclick: () => formularzCelu(null, odswiez) }, '+ Cel')),
      cele.length ? el('div', { style: 'display:flex; flex-direction:column; gap:14px' },
        ...cele.map(c => blokCelu(c, odswiez)))
        : el('div', { class: 'puste', style: 'padding:12px' },
          'Brak celów. Dodaj cel na kwartał (np. 2026Q3) — przychód ważony, marża, wygrane, tematy na Komitecie.')),

    // --- Alerty: tematy bez ruchu / zastygle ---
    (r.bez_ruchu.length || r.zastygle.length) ? el('div', { style: 'display:grid; grid-template-columns: 1fr 1fr; gap:16px; align-items:start' },
      el('div', { class: 'karta-box' },
        el('h2', { style: 'margin-top:0' }, '⚠️ Tematy bez następnego kroku (', String(r.bez_ruchu.length), ')'),
        r.bez_ruchu.length ? el('div', {}, ...r.bez_ruchu.map(t => wierszTematu(t)))
          : el('div', { class: 'puste', style: 'padding:14px' }, 'Każdy temat ma zaplanowane zadanie 👍')),
      el('div', { class: 'karta-box' },
        el('h2', { style: 'margin-top:0' }, '🕒 Zastygłe (', String(r.zastygle.length), ')'),
        r.zastygle.length ? el('div', {}, ...r.zastygle.map(t => wierszTematu(t, true)))
          : el('div', { class: 'puste', style: 'padding:14px' }, 'Brak zastygłych tematów')))
      : '',

    // --- Zadania tygodnia per temat ---
    el('h2', {}, 'Zadania na ten tydzień'),
    Object.keys(grupy).length ? el('div', {}, ...Object.values(grupy).map(g => kartaGrupy(g, odswiez)))
      : el('div', { class: 'karta-box puste' }, 'Brak zaplanowanych zadań na ten tydzień. Dodaj zadania z biblioteki na temacie.'),
  );
}

// Tydzien vs plan: co MUSI sie wydarzyc w tym tygodniu, zeby plan sprzedazy sie spinal,
// oraz aktualny stan projekcji (firma + handlowcy). Szczegoly i lejek odwrocony: karta PDCA.
function sekcjaTydzienVsPlan(pw) {
  const naPlanie = pw.projekcja >= pw.plan_firmowy;
  const pasek = (zrobione, wymagane) => {
    const proc = wymagane > 0 ? Math.min(100, Math.round(100 * zrobione / wymagane)) : 100;
    return el('div', { style: 'flex:1; background:var(--szary-tlo); border-radius:6px; height:16px; overflow:hidden; min-width:90px' },
      el('div', { style: `height:100%; width:${proc}%; background:${proc >= 100 ? 'var(--zielony)' : 'var(--akcent)'}; min-width:2px` }));
  };

  return el('div', { class: 'karta-box', style: 'border-left: 4px solid ' + (naPlanie ? 'var(--zielony)' : 'var(--akcent)') },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0' }, ikona('cel'), ' Ten tydzień vs plan sprzedaży ',
        badge(`od ${dataPl(pw.tydzien.od)}`, 'szary')),
      el('a', { class: 'btn btn-maly', href: '#/pdca' }, 'Szczegóły i lejek → PDCA')),

    // Stan projekcji: firma
    el('div', { class: 'kafle' },
      kafel('Plan sprzedaży ' + pw.okres, mln(pw.plan_firmowy) + ' PLN', null, 'cel'),
      kafel('Idziemy na', mln(pw.projekcja) + ' PLN',
        `wygrane ${mln(pw.wygrane.w)} + ważony ${mln(pw.wazony)}`, 'prognoza', naPlanie ? 'ziel' : 'zol'),
      kafel('Luka', mln(pw.luka) + ' PLN', naPlanie ? 'plan pokryty' : `${pw.tygodnie_pozostale} tyg. do końca okresu`, 'alert', naPlanie ? 'ziel' : 'czer')),

    // Wymagane w tym tygodniu vs zrobione
    el('h2', { style: 'font-size:14px; margin-top:4px' }, 'Niezbędne w tym tygodniu (z lejka odwróconego)'),
    pw.luka <= 0 ? el('div', { class: 'info-box' }, 'Projekcja pokrywa plan — tygodniowe minima wynoszą 0. Utrzymuj tempo działań z roadmapy i pilnuj tematów zagrożonych.') : '',
    el('div', { style: 'display:flex; flex-direction:column; gap:8px' },
      ...pw.tydzien.pozycje.map(p => el('div', { style: 'display:flex; align-items:center; gap:12px' },
        el('div', { style: 'width:150px; font-size:13px; font-weight:600' }, p.poziom),
        pasek(p.zrobione, p.wymagane),
        el('div', { style: 'width:200px; font-size:12px; color:var(--tekst-2); text-align:right' },
          `${p.zrobione} / ${p.wymagane} wymaganych` + (p.zaplanowane != null ? ` · ${p.zaplanowane} zaplan.` : '')),
        el('div', { style: 'width:90px; text-align:right' },
          p.zrobione >= p.wymagane ? badge('✓ jest', 'zielony') : badge(`−${+(p.wymagane - p.zrobione).toFixed(1)}`, 'czerwony'))))),

    // Stan projekcji per handlowiec
    pw.handlowcy.length ? el('div', {},
      el('h2', { style: 'font-size:14px' }, 'Projekcje handlowców'),
      tabela([
        { naglowek: 'Handlowiec', render: h => el('span', { style: 'display:inline-flex; align-items:center; gap:6px' }, awatar(h.handlowiec), el('b', {}, h.handlowiec)) },
        { naglowek: 'Plan', klasa: 'liczba', render: h => mln(h.plan) },
        { naglowek: 'Idzie na', klasa: 'liczba', render: h => el('b', {}, mln(h.projekcja)) },
        {
          naglowek: 'Luka', klasa: 'liczba', render: h => h.luka <= 0
            ? badge('✓ plan', 'zielony') : el('span', { style: 'color:var(--czerwony); font-weight:700' }, mln(h.luka))
        },
        { naglowek: 'Działania: tydzień', klasa: 'liczba', render: h => `${h.tydzien_dzialania} / ${h.potrzebne_dzialania_tydz}` },
        { naglowek: 'Leady: tydzień', klasa: 'liczba', render: h => `${h.tydzien_leady} / ${h.potrzebne_leady_tydz}` },
      ], pw.handlowcy)) : '');
}

function blokCelu(c, odswiez) {
  // Ringi postepu per miara (Livespace-style) + awatar handlowca
  const pozycje = [
    ['Przychód ważony', c.przychod_wazony, c.wykonanie.przychod_wazony, 'mln'],
    ['Marża', c.marza, c.wykonanie.marza, 'mln'],
    ['Wygrane', c.wygrane, c.wykonanie.wygrane, ''],
    ['Komitety', c.tematy_komitet, c.wykonanie.tematy_komitet, ''],
  ].filter(([, plan]) => plan != null && plan !== 0);
  return el('div', { style: 'border:1px solid var(--linia); border-radius:10px; padding:12px 14px' },
    el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px' },
      el('div', { style: 'display:flex; align-items:center; gap:8px' },
        awatar(c.handlowiec), el('b', {}, c.handlowiec), badge(c.okres, 'nieb')),
      el('div', { style: 'display:flex; gap:6px' },
        el('button', { class: 'btn btn-maly', onclick: () => formularzCelu(c, odswiez) }, ikona('edytuj', 13)),
        el('button', { class: 'btn btn-maly btn-czerwony', onclick: async () => { await DEL('/cele/' + c.id); toast('Cel usunięty'); odswiez(); } }, ikona('x', 13)))),
    el('div', { style: 'display:flex; gap:22px; flex-wrap:wrap' },
      ...pozycje.map(([nazwa, plan, wyk, jedn]) => {
        const proc = plan ? Math.round(100 * (wyk || 0) / plan) : 0;
        return el('div', { style: 'display:flex; flex-direction:column; align-items:center; gap:4px' },
          ring(proc, 64),
          el('div', { style: 'font-size:12px; font-weight:600' }, nazwa),
          el('div', { style: 'font-size:11px; color:var(--tekst-2)' },
            `${jedn === 'mln' ? mln(wyk || 0) : (wyk || 0)} / ${jedn === 'mln' ? mln(plan) : plan}`));
      })));
}

function formularzCelu(c, odswiez) {
  const teraz = new Date();
  const domyslnyOkres = `${teraz.getFullYear()}Q${Math.floor(teraz.getMonth() / 3) + 1}`;
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'okres', label: 'Okres (2026Q3 lub 2026)', wymagane: true, wartosc: c?.okres || domyslnyOkres }),
    pole({ name: 'handlowiec', label: 'Handlowiec', wymagane: true, wartosc: c?.handlowiec || 'K. Latoś' }),
    pole({ name: 'sprzedaz', label: 'Plan SPRZEDAŻY (mln) — podpisane umowy', typ: 'number', step: '0.1', wartosc: c?.sprzedaz, pomoc: 'Zasila kontrolę „na co idziemy" w PDCA' }),
    pole({ name: 'przychod_wazony', label: 'Cel: przychód ważony (mln)', typ: 'number', step: '0.1', wartosc: c?.przychod_wazony }),
    pole({ name: 'marza', label: 'Cel: marża (mln)', typ: 'number', step: '0.1', wartosc: c?.marza }),
    pole({ name: 'wygrane', label: 'Cel: liczba wygranych', typ: 'number', wartosc: c?.wygrane }),
    pole({ name: 'tematy_komitet', label: 'Cel: tematy na Komitecie', typ: 'number', wartosc: c?.tematy_komitet }),
    pole({ name: 'notatka', label: 'Notatka', typ: 'textarea', wartosc: c?.notatka, szerokie: true }));
  modal(c ? 'Edytuj cel' : 'Nowy cel sprzedażowy', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.okres || !d.handlowiec) { toast('Okres i handlowiec są wymagane', true); return false; }
    try {
      if (c) await PUT('/cele/' + c.id, d);
      else await POST('/cele', d);
      toast('Cel zapisany'); odswiez();
    } catch (e) { toast(e.message, true); return false; }
  }]]);
}

function kafel(etykieta, wartosc, drobne, ikonaNazwa, odcien = '') {
  return el('div', { class: 'kafel' },
    ikonaNazwa ? el('div', { class: 'ikona-tlo ' + odcien }, ikona(ikonaNazwa, 18)) : null,
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, wartosc),
    drobne ? el('div', { class: 'drobne' }, drobne) : null);
}

function wierszTematu(t, zZastygnieciem) {
  return el('div', {
    class: 'link', style: 'display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--linia)',
    onclick: () => location.hash = '#/tematy/' + t.id
  },
    el('span', {}, el('b', {}, t.identyfikator), ' ', el('span', { style: 'color:var(--tekst-2)' }, t.klient_nazwa || '')),
    el('span', {}, badge(t.kamien_kod || '—', 'nieb'),
      zZastygnieciem ? ' ' + `${t.dni_w_etapie} dni` : ''));
}

function kartaGrupy(g, odswiez) {
  return el('div', { class: 'karta-box' },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0; font-size:15px' },
        g.temat_id ? el('a', { class: 'link', href: '#/tematy/' + g.temat_id }, g.naglowek)
          : (g.lead_id ? el('a', { class: 'link', href: '#/leady/' + g.lead_id }, g.naglowek) : g.naglowek),
        g.klient ? el('span', { style: 'color:var(--tekst-2); font-weight:400; font-size:13px' }, ' · ' + g.klient) : ''),
      el('span', { style: 'color:var(--tekst-2); font-size:12px' }, `${g.zadania.length} zad.`)),
    ...g.zadania.map(z => zadanieWiersz(z, odswiez)));
}

function zadanieWiersz(z, odswiez) {
  const efekt = z.oczekiwany_efekt ? el('div', { style: 'font-size:12px; color:var(--tekst-2); margin-top:2px' }, '→ efekt: ' + z.oczekiwany_efekt) : '';
  const przyciski = el('div', { style: 'display:flex; gap:6px; flex-shrink:0' },
    ...['Osiągnięty', 'Nieosiągnięty'].map(w => el('button', {
      class: 'btn btn-maly' + (w === 'Osiągnięty' ? ' btn-zielony' : ' btn-czerwony'),
      onclick: async (e) => {
        e.stopPropagation();
        try {
          const r = await POST(`/dzialania/${z.id}/wynik`, { wynik: w });
          toast(r.co_dalej ? `Zapisano. Co dalej: ${r.co_dalej}` : 'Wynik zapisany: ' + w);
          odswiez();
        } catch (err) { toast(err.message, true); }
      }
    }, w)));
  const ikonaTypu = z.typ ? ikona(IKONA_TYPU_DZIALANIA[String(z.typ).toLowerCase()] || 'dzialania', 15) : null;
  return el('div', { style: 'display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--linia)' },
    el('div', { style: 'display:flex; gap:10px; align-items:flex-start' },
      el('div', { style: 'color:var(--akcent); padding-top:2px' }, ikonaTypu || ikona('dzialania', 15)),
      el('div', {},
        el('div', {}, z.kamien_kod ? badge(z.kamien_kod, 'akcent') : '', ' ', z.typ ? el('span', { style: 'color:var(--tekst-2); font-size:12px' }, z.typ + ' · ') : '', z.termin ? el('span', { style: 'color:var(--tekst-2); font-size:12px' }, dataPl(z.termin)) : '',
          el('div', { style: 'font-weight:600; margin-top:2px' }, z.cel), efekt))),
    przyciski);
}
