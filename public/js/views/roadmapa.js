// Roadmapa tygodnia handlowca + pulpit postepow (widok startowy).
// Zadania tygodnia pogrupowane per temat, z oczekiwanym efektem i podpowiedzia "co dalej".
// Regula "zawsze nastepny krok": tematy bez otwartego zadania sa wyroznione.
import { GET, POST } from '../api.js';
import { el, toast, mln, badge, dataPl } from '../ui.js';

export async function widokRoadmapa(kontener) {
  const r = await GET('/roadmapa');
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
      kafel('Tematy otwarte', String(r.postep.tematy_otwarte)),
      kafel('Wartość ważona', mln(r.postep.wartosc_wazona) + ' PLN', 'suma wartość × prawdopodobieństwo'),
      kafel('Zastygłe', String(r.postep.liczba_zastygle), 'przekroczony próg czasu w etapie'),
      kafel('Bez ruchu', String(r.postep.liczba_bez_ruchu), 'brak otwartego zadania'),
      kafel('Recykling', String(r.postep.recykling), 'w puli powrotów')),

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

function kafel(etykieta, wartosc, drobne) {
  return el('div', { class: 'kafel' },
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
  return el('div', { style: 'display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--linia)' },
    el('div', {},
      el('div', {}, z.kamien_kod ? badge(z.kamien_kod, 'akcent') : '', ' ', z.typ ? el('span', { style: 'color:var(--tekst-2); font-size:12px' }, z.typ + ' · ') : '', z.termin ? el('span', { style: 'color:var(--tekst-2); font-size:12px' }, dataPl(z.termin)) : '',
        el('div', { style: 'font-weight:600; margin-top:2px' }, z.cel), efekt)),
    przyciski);
}
