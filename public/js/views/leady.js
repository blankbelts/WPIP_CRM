// Leady - sciezka pozyskania tematu:
//   Lead surowy -> Kwalifikacja wstepna (szybka triage) -> Research -> Scoring (gleboki) -> Zakwalifikowany -> Komitet
// Os prawdopodobienstwa: "% szansy na KWALIFIKACJE" (nie mylic z % wygranej tematu)
import { GET, POST, PUT, slowniki } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badgePriorytet, badgeStatus, badge, dataPl, pct } from '../ui.js';
import { formularzDzialania, listaDzialan } from './dzialania.js';

const KOLORY_RESEARCHU = { SZARY: 'szary', ZIELONY: 'zielony', 'ŻÓŁTY': 'zolty', CZERWONY: 'czerwony' };
export function badgeResearch(s) { return s ? badge('R: ' + s, KOLORY_RESEARCHU[s] || 'szary') : ''; }

const KOLORY_WERDYKTU = { 'interesujący': 'zielony', 'do decyzji': 'zolty', 'odpuszczony': 'czerwony' };
function badgeWerdykt(w) { return w ? badge(w, KOLORY_WERDYKTU[w] || 'szary') : ''; }

// Karta kanbanu dopasowana do etapu sciezki - dolna linia pokazuje to, co wazne na danym kamieniu
function kartaLeada(l) {
  let dol;
  if (l.kamien === 'Lead surowy') dol = el('span', { style: 'color:var(--tekst-2)' }, l.kwalif_wynik ? badgeWerdykt(l.kwalif_wynik) : '→ do kwalifikacji');
  else if (l.kamien === 'Kwalifikacja wstępna') dol = el('span', {}, badgeWerdykt(l.kwalif_wynik), ' ', l.proces_researchu ? el('span', { style: 'color:var(--tekst-2); font-size:11px' }, l.proces_researchu.slice(0, 20)) : '');
  else if (l.kamien === 'Research') dol = l.fast_track ? badge('fast-track', 'zielony') : badgeResearch(l.status_researchu);
  else if (l.kamien === 'Scoring') dol = el('span', {}, badgeResearch(l.status_researchu), ' ', l.scoring_potwierdzony ? badge('✓ scoring', 'zielony') : el('span', { style: 'color:var(--tekst-2); font-size:11px' }, 'do potwierdzenia'));
  else if (l.kamien === 'Zakwalifikowany') dol = el('span', {}, badge('→ Komitet', 'akcent'));
  else dol = badgeResearch(l.status_researchu);

  return el('div', {
    class: 'kanban-karta',
    style: l.dyskwalifikacja_x ? 'border-left-color:var(--czerwony)' : (l.fast_track ? 'border-left-color:var(--zielony)' : ''),
    onclick: () => location.hash = '#/leady/' + l.id
  },
    el('div', { class: 'kk-id' }, l.nazwa.slice(0, 60)),
    el('div', { class: 'kk-info' },
      el('span', {}, badgePriorytet(l.priorytet), ' ', String(l.score_total), ' pkt'),
      el('span', {}, l.dzialania_otwarte ? `${l.dzialania_otwarte} dz.` : '')),
    el('div', { class: 'kk-info', style: 'margin-top:4px' }, el('span', {}, dol)));
}

export async function widokLeady(kontener, query = '') {
  const params = new URLSearchParams(query);
  const [leady, grupy, sl] = await Promise.all([GET('/leady'), GET('/grupy'), slowniki()]);
  const kamienie = (sl.kamien_prospectingu || []).map(k => k.wartosc);

  let filtrGrupa = params.get('grupa') || '', filtrPrio = '', filtrStatus = 'aktywny', widok = 'sciezka';

  const box = el('div');
  function przefiltrowane() {
    return leady.filter(l =>
      (!filtrGrupa || String(l.grupa_id) === String(filtrGrupa)) &&
      (!filtrPrio || l.priorytet === filtrPrio) &&
      (!filtrStatus || l.status === filtrStatus));
  }

  function rysuj() {
    const dane = przefiltrowane();
    box.innerHTML = '';
    if (widok === 'sciezka') {
      box.append(el('div', { class: 'kanban' },
        ...kamienie.map(kamien => {
          const wKolumnie = dane.filter(l => l.kamien === kamien);
          return el('div', { class: 'kanban-kolumna' },
            el('div', { class: 'kanban-naglowek' }, el('span', {}, kamien), el('span', {}, String(wKolumnie.length))),
            ...wKolumnie.map(kartaLeada));
        })));
    } else {
      box.append(tabela([
        { naglowek: 'Prio', klasa: 'wysrodkuj', render: w => badgePriorytet(w.priorytet) },
        { naglowek: 'Scoring', klasa: 'liczba', render: w => String(w.score_total) },
        { naglowek: 'Lead', render: w => w.nazwa },
        { naglowek: 'ID tematu', render: w => w.identyfikator || '—' },
        { naglowek: 'Kamień', render: w => w.kamien },
        { naglowek: 'Proces researchu', render: w => w.proces_researchu || '—' },
        { naglowek: 'Research', render: w => badgeResearch(w.status_researchu) },
        { naglowek: 'Status', render: w => badgeStatus(w.status) },
      ], dane, w => location.hash = '#/leady/' + w.id));
    }
  }
  rysuj();

  const filtrSelect = (etykieta, opcje, ustaw, wybrane = '') => el('select', {
    onchange: e => { ustaw(e.target.value); rysuj(); }
  }, el('option', { value: '' }, etykieta),
    ...opcje.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return el('option', { value: v, selected: String(v) === String(wybrane) }, l); }));

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Leady / Prospecting'),
        el('p', { class: 'podtytul' }, 'Szybka kwalifikacja wstępna → (interesujące) głęboki scoring z researchem → Komitet Ofertowy')),
      el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' },
        el('button', { class: 'btn', onclick: () => masowaKwalifikacja(filtrGrupa, grupy) }, '⚡ Kwalifikuj wstępnie'),
        el('button', { class: 'btn btn-glowny', onclick: () => formularzLeada(grupy, sl, () => location.reload()) }, '+ Nowy lead'))),
    el('div', { class: 'filtry' },
      el('select', { onchange: e => { widok = e.target.value; rysuj(); } },
        el('option', { value: 'sciezka' }, 'Widok: ścieżka (kanban)'),
        el('option', { value: 'tabela' }, 'Widok: tabela')),
      filtrSelect('Grupa: wszystkie', grupy.map(g => [g.id, g.nazwa]), v => filtrGrupa = v, filtrGrupa),
      filtrSelect('Priorytet: wszystkie', ['A', 'B', 'C', 'D', 'X'], v => filtrPrio = v),
      el('select', { onchange: e => { filtrStatus = e.target.value; rysuj(); } },
        ...[['aktywny', 'Status: aktywne'], ['uspiony', 'Status: uśpione (nurture)'], ['odpuszczony', 'Status: odpuszczone'],
            ['przekazany do pipeline', 'Status: w pipeline'], ['', 'Status: wszystkie']].map(([v, l]) =>
          el('option', { value: v }, l)))),
    box);
}

function masowaKwalifikacja(filtrGrupa, grupy) {
  const nazwaGrupy = filtrGrupa ? (grupy.find(g => String(g.id) === String(filtrGrupa))?.nazwa || '') : 'wszystkich grup';
  modal('Wstępna kwalifikacja leadów', el('div', {},
    el('div', { class: 'info-box' },
      `Auto-triage leadów na etapie „Lead surowy" (${filtrGrupa ? 'grupa: ' + nazwaGrupy : 'wszystkie grupy'}) na podstawie danych z importu. `
      + 'System sam odpowiada na pytania kwalifikacji z profilu (typologia, wartość, profil inwestora, dopasowanie) i przypisuje proces researchu. '
      + 'Interesujące → przechodzą do kwalifikacji, twarda dyskwalifikacja → odpuszczone. Werdykty możesz potem ręcznie skorygować na każdym leadzie.')),
    [['Uruchom kwalifikację', 'btn-glowny', async () => {
      const stat = await POST('/leady/kwalifikuj-wstepnie', { grupa_id: filtrGrupa || null });
      toast(`Przetworzono ${stat.przetworzone}: ${stat.interesujace} interesujących, ${stat.do_decyzji} do decyzji, ${stat.odpuszczone} odpuszczonych`);
      location.reload();
    }]]);
}

export async function widokLead(kontener, id) {
  const [lead, sl] = await Promise.all([GET('/leady/' + id), slowniki()]);
  const odswiez = () => widokLead((kontener.innerHTML = '', kontener), id);
  const kamienie = lead.kamienie;
  const aktIdx = kamienie.indexOf(lead.kamien);
  const aktywny = lead.status === 'aktywny';

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, lead.nazwa, ' ', badgePriorytet(lead.priorytet), ' ', badgeStatus(lead.status),
          lead.fast_track ? ' ' : '', lead.fast_track ? badge('fast-track', 'zielony') : ''),
        el('p', { class: 'podtytul' },
          `ID tematu: ${lead.identyfikator || '—'} · grupa: ${lead.grupa_nazwa || '—'} · scoring ${lead.score_total} pkt · % kwalifikacji: ${lead.prawd_kwalifikacji}%`)),
      el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' },
        aktywny && !lead.fast_track ? el('button', { class: 'btn', onclick: () => fastTrack(lead, odswiez) }, '⏫ Fast-track') : '',
        aktywny ? el('button', { class: 'btn', onclick: () => zmienStatus(lead, 'uspiony', sl, odswiez) }, 'Uśpij') : '',
        aktywny ? el('button', { class: 'btn btn-czerwony', onclick: () => zmienStatus(lead, 'odpuszczony', sl, odswiez) }, 'Odpuść') : '',
        !aktywny && !lead.temat_id ? el('button', { class: 'btn', onclick: async () => { await POST(`/leady/${id}/status`, { status: 'aktywny' }); toast('Przywrócono'); odswiez(); } }, 'Przywróć') : '',
        lead.temat_id ? el('a', { class: 'btn btn-zielony', href: '#/tematy/' + lead.temat_id }, 'Przejdź do tematu →') : '')),

    lead.dyskwalifikacja_x ? el('div', { class: 'ostrzezenie' }, '⛔ Dyskwalifikacja (X): ', lead.dyskwalifikacja_powod || '') : '',
    lead.status === 'odpuszczony' ? el('div', { class: 'ostrzezenie' }, 'Lead odpuszczony: ', lead.powod_odpuszczenia || '') : '',
    lead.fast_track ? el('div', { class: 'info-box' }, '⏫ Fast-track (wyjątek od bramki): ', lead.fast_track_powod || '') : '',

    // ---- Sciezka ----
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Ścieżka pozyskania tematu'),
      el('div', { class: 'info-box' },
        'Przejście = Twoja decyzja. Bramki: „Kwalifikacja wstępna" wymaga werdyktu „interesujący" + procesu researchu; wyjście za „Research" wymaga koloru (A: ZIELONY/ŻÓŁTY); wejście na „Zakwalifikowany" wymaga potwierdzenia scoringu. Fast-track omija bramki.'),
      el('div', { class: 'stepper' },
        ...kamienie.map((k, i) => el('div', {
          class: 'step' + (i < aktIdx ? ' zaliczony' : '') + (i === aktIdx ? ' aktualny' : ''),
          onclick: async () => {
            if (k === lead.kamien || !aktywny) return;
            try {
              await POST(`/leady/${id}/kamien`, { kamien: k });
              toast(k === 'Zakwalifikowany' ? 'Lead w kolejce Komitetu Ofertowego' : 'Kamień: ' + k);
              odswiez();
            } catch (err) { toast(err.message, true); }
          }
        }, `${i + 1}. ${k}`))),
      lead.kamien === 'Zakwalifikowany' && !lead.temat_id
        ? el('a', { class: 'btn btn-glowny', href: '#/komitet', style: 'margin-top:8px' }, 'Otwórz kolejkę Komitetu →') : ''),

    // ---- Kwalifikacja wstepna ----
    sekcjaKwalifikacji(lead, sl, odswiez),

    // ---- Research ----
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Research (weryfikacja KRS / web) — ', badgeResearch(lead.status_researchu)),
      el('div', { class: 'info-box' },
        'ZIELONY = potwierdzony · ŻÓŁTY = czynnik ryzyka (obowiązkowa notatka) · CZERWONY = dyskwalifikacja post-research · SZARY = wymaga weryfikacji'),
      el('div', { class: 'filtry' },
        ...['ZIELONY', 'ŻÓŁTY', 'CZERWONY', 'SZARY'].map(s => el('button', {
          class: 'btn btn-maly' + (lead.status_researchu === s ? ' btn-glowny' : ''),
          onclick: () => {
            const notatkaInput = el('textarea', { placeholder: s === 'ŻÓŁTY' ? 'Czynnik ryzyka (obowiązkowe)' : 'Notatka z researchu' }, lead.research_notatka || '');
            modal(`Research: ${s}`, el('div', { class: 'pole' }, el('label', {}, 'Notatka'), notatkaInput),
              [['Zapisz', 'btn-glowny', async () => {
                await POST(`/leady/${id}/research`, { status: s, notatka: notatkaInput.value || null });
                toast(s === 'CZERWONY' ? 'CZERWONY — rozważ odpuszczenie' : 'Research: ' + s);
                odswiez();
              }]]);
          }
        }, s))),
      lead.research_notatka ? el('p', { style: 'margin:8px 0 0' }, el('b', {}, 'Notatka: '), lead.research_notatka) : ''),

    // ---- Scoring (gleboki, po researchu) ----
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, `Scoring — ${lead.score_total} pkt → priorytet ${lead.priorytet}`),
        el('button', {
          class: 'btn btn-maly ' + (lead.scoring_potwierdzony ? 'btn-zielony' : ''),
          onclick: async () => { const r = await POST(`/leady/${id}/potwierdz-scoring`, {}); toast(r.scoring_potwierdzony ? 'Scoring potwierdzony' : 'Cofnięto'); odswiez(); }
        }, lead.scoring_potwierdzony ? '✓ Scoring potwierdzony' : 'Potwierdź scoring po researchu')),
      el('div', { class: 'info-box' },
        `Wersja: ${lead.wersja_nazwa || '—'} (progi A ≥ ${lead.prog_a ?? '—'} · B ≥ ${lead.prog_b ?? '—'} · C ≥ ${lead.prog_c ?? '—'}). Głęboki scoring — weryfikuj wybory realnymi danymi z researchu, potem potwierdź.`),
      el('div', { class: 'form-siatka' },
        ...Object.entries(lead.opcje_wersji).map(([komp, opcje]) => {
          const wybor = lead.wybory[komp];
          const opcja = opcje.find(o => o.etykieta === wybor);
          return el('div', { class: 'pole' },
            el('label', {}, `${komp} (${opcja ? opcja.punkty + ' pkt' : 'brak'})${opcja?.dyskwalifikacja ? ' ⛔' : ''}`),
            el('select', {
              onchange: async (e) => {
                try { const r = await POST(`/leady/${id}/wybory`, { komponent: komp, etykieta: e.target.value }); toast(`${r.score_total} pkt → ${r.priorytet}`); odswiez(); }
                catch (err) { toast(err.message, true); odswiez(); }
              }
            },
              el('option', { value: '', selected: !wybor }, '— brak —'),
              ...opcje.map(o => el('option', { value: o.etykieta, selected: o.etykieta === wybor }, `${o.etykieta} (${o.punkty}${o.dyskwalifikacja ? ', X' : ''})`))));
        }))),

    // ---- Kontekst handlowy + dane E2E ----
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Kontekst handlowy i dane do ZOS'),
        el('div', { style: 'display:flex; gap:8px' },
          el('button', { class: 'btn btn-maly', onclick: () => pokazZos(lead) }, 'Pakiet ZOS →'),
          el('button', { class: 'btn btn-maly', onclick: () => edytujKontekst(lead, sl, odswiez) }, 'Edytuj'))),
      el('div', { class: 'szczegoly' },
        poz('Klient', lead.klient_nazwa ? el('a', { class: 'link', href: '#/klienci/' + lead.klient_id }, lead.klient_nazwa) : '—'),
        poz('Sposób pozyskania', lead.sposob_pozyskania || '—'),
        poz('Źródło wiedzy o WPIP', lead.zrodlo_wiedzy_wpip || '— uzupełnij (potrzeba Marketingu) —'),
        poz('Proces researchu', lead.proces_researchu || '—'),
        poz('Inwestycja', lead.inwestycja_nazwa || '—'),
        poz('Etap (z inwestycji)', lead.etap_projektu || '—'),
        poz('Lokalizacja', [lead.inwestycja_miasto, lead.wojewodztwo].filter(Boolean).join(', ') || '—'),
        poz('Handlowiec', lead.handlowiec || '—')),
      el('div', { style: 'margin-top:10px' },
        poz('Dobry powód kontaktu (PWE)', lead.dobry_powod_kontaktu || '— uzupełnij przed pierwszym kontaktem —'),
        el('div', { style: 'height:8px' }),
        poz('Notatki', lead.notatki || '—'))),

    lead.wystapienia.length ? el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Wystąpienia w innych bazach'),
      tabela([
        { naglowek: 'Data', render: w => dataPl(w.data) },
        { naglowek: 'Grupa', render: w => w.grupa_nazwa || '—' },
        { naglowek: 'Notatka', render: w => w.notatka || '—' },
      ], lead.wystapienia)) : '',

    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Działania (sekwencja kontaktu)'),
        el('button', { class: 'btn btn-maly', onclick: () => formularzDzialania({ lead_id: lead.id, klient_id: lead.klient_id }, odswiez) }, '+ Działanie')),
      listaDzialan(lead.dzialania, odswiez)),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Historia leada (audyt)'),
      tabela([
        { naglowek: 'Data', render: w => new Date(w.data + 'Z').toLocaleString('pl-PL') },
        { naglowek: 'Zmiana', render: w => w.typ_zmiany },
        { naglowek: 'Przed', render: w => w.wartosc_przed || '—' },
        { naglowek: 'Po', render: w => w.wartosc_po || '—' },
        { naglowek: 'Opis', render: w => w.opis || '—' },
      ], lead.historia)),

    lead.decyzje.length ? el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Decyzje Komitetu'),
      tabela([
        { naglowek: 'Data', render: w => dataPl(w.data) },
        { naglowek: 'Decyzja', render: w => badgeDecyzja(w.decyzja) },
        { naglowek: 'Powód', render: w => w.powod || '—' },
      ], lead.decyzje)) : '',
  );
}

function sekcjaKwalifikacji(lead, sl, odswiez) {
  const aktywny = lead.status === 'aktywny';
  const procesy = (sl.proces_researchu || []).map(p => p.wartosc);
  const stan = { ...lead.kwalif_odpowiedzi };
  const procesInput = el('select', {},
    el('option', { value: '' }, '— wybierz proces researchu —'),
    ...procesy.map(p => el('option', { value: p, selected: p === lead.proces_researchu }, p)));

  const podglad = el('div', { class: 'info-box' });
  function odswiezPodglad() {
    const odp = Object.values(stan);
    const tak = odp.filter(a => a === 'tak').length, nie = odp.filter(a => a === 'nie').length;
    podglad.textContent = `Odpowiedzi: ${tak}× tak, ${nie}× nie. Werdykt ustalasz Ty — system tylko podpowiada.`;
  }

  const pytaniaBox = el('div', {},
    ...lead.pytania_kwalifikacji.map(p => el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--linia)' },
      el('span', {}, p.dyskwalifikujace ? el('b', { style: 'color:var(--czerwony)' }, '⛔ ') : '', p.tekst),
      el('div', { style: 'display:flex; gap:4px; flex-shrink:0' },
        ...['tak', 'nie', '?'].map(v => {
          const btn = el('button', { class: 'btn btn-maly' + (stan[p.id] === v ? ' btn-glowny' : '') }, v);
          btn.addEventListener('click', () => {
            stan[p.id] = v;
            for (const b of btn.parentNode.children) b.className = 'btn btn-maly';
            btn.className = 'btn btn-maly btn-glowny';
            odswiezPodglad();
          });
          return btn;
        })))));
  odswiezPodglad();

  return el('div', { class: 'karta-box' },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0' }, 'Kwalifikacja wstępna (szybka triage)', lead.kwalif_wynik ? ' ' : '', badgeWerdykt(lead.kwalif_wynik)),
      el('span', { style: 'color:var(--tekst-2); font-size:12px' }, 'Najważniejsze pytania ze strategii sprzedaży — selekcja lepszych i gorszych tematów')),
    aktywny ? el('div', {},
      pytaniaBox,
      podglad,
      el('div', { class: 'form-siatka', style: 'margin-top:10px' },
        el('div', { class: 'pole' }, el('label', {}, 'Proces researchu (wymagany, gdy interesujący)'), procesInput)),
      el('div', { style: 'display:flex; gap:8px; margin-top:10px; flex-wrap:wrap' },
        el('button', {
          class: 'btn btn-zielony', onclick: () => zapisz('interesujący')
        }, 'Interesujący → do researchu'),
        el('button', { class: 'btn', onclick: () => zapisz('do decyzji') }, 'Do decyzji (obserwuj)'),
        el('button', { class: 'btn btn-czerwony', onclick: () => zapisz('odpuszczony') }, 'Odpuść (przedkomitetowo)'))) :
      el('p', { style: 'color:var(--tekst-2)' }, 'Werdykt: ', badgeWerdykt(lead.kwalif_wynik) || '—',
        lead.proces_researchu ? ` · proces: ${lead.proces_researchu}` : ''));

  async function zapisz(wynik) {
    if (wynik === 'interesujący' && !procesInput.value) { toast('Wybierz proces researchu dla interesującego tematu', true); return; }
    try {
      const r = await POST(`/leady/${lead.id}/kwalifikacja`, { odpowiedzi: stan, wynik, proces_researchu: procesInput.value || null });
      toast(`Werdykt: ${r.werdykt}` + (r.werdykt !== r.sugestia ? ` (system sugerował: ${r.sugestia})` : ''));
      odswiez();
    } catch (e) { toast(e.message, true); }
  }
}

function poz(et, wa) {
  return el('div', { class: 'poz' }, el('div', { class: 'et' }, et), el('div', { class: 'wa' }, wa));
}

export function badgeDecyzja(d) {
  const mapa = { bid: ['BID — ofertujemy', 'zielony'], no_bid: ['NO BID — odpuszczamy', 'czerwony'], defer: ['DEFER — dopytujemy', 'zolty'] };
  const [t, k] = mapa[d] || [d, 'szary'];
  return el('span', { class: 'badge badge-' + k }, t);
}

function fastTrack(lead, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'powod', label: 'Uzasadnienie eskalacji (kto i dlaczego)', typ: 'textarea', wymagane: true, szerokie: true, placeholder: 'np. Temat od Zarządu — strategiczny mimo scoringu poniżej progu' }));
  modal('Fast-track — wyjątek od bramki scoringowej', el('div', {},
    el('div', { class: 'info-box' }, 'Fast-track pozwala prowadzić lead przez ścieżkę z pominięciem bramek (kwalifikacja, scoring). Zostaje w audycie. CZERWONY research nadal blokuje.'), form),
    [['Oznacz fast-track', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (!d.powod) { toast('Uzasadnienie jest wymagane', true); return false; }
      await POST(`/leady/${lead.id}/fast-track`, { powod: d.powod });
      toast('Lead oznaczony jako fast-track'); odswiez();
    }]]);
}

function zmienStatus(lead, status, sl, odswiez) {
  if (status === 'uspiony') {
    modal('Uśpienie leada (nurture)', el('p', {}, 'Lead trafi do uśpionych — obserwuj/grzej, wróć gdy pojawi się sygnał.'),
      [['Uśpij', 'btn-glowny', async () => { await POST(`/leady/${lead.id}/status`, { status: 'uspiony' }); toast('Uśpiony'); odswiez(); }]]);
  } else {
    const powody = (sl.powod_odpuszczenia || []).map(p => p.wartosc);
    const form = el('div', { class: 'form-siatka' },
      pole({ name: 'powod', label: 'Powód odpuszczenia (obowiązkowy)', typ: 'select', opcje: powody, wymagane: true }));
    modal('Odpuszczenie leada', form, [['Odpuść', 'btn-czerwony', async () => {
      const d = zbierzForm(form);
      if (!d.powod) { toast('Powód jest obowiązkowy', true); return false; }
      await POST(`/leady/${lead.id}/status`, { status: 'odpuszczony', powod: d.powod });
      toast('Odpuszczony'); odswiez();
    }]]);
  }
}

function edytujKontekst(lead, sl, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa leada', wartosc: lead.nazwa, szerokie: true }),
    pole({ name: 'identyfikator', label: 'ID tematu (Inwestor_TypObiektu)', wartosc: lead.identyfikator, pomoc: 'Wspólne ID — od leada po ZOS i wynik' }),
    pole({ name: 'handlowiec', label: 'Handlowiec / opiekun', wartosc: lead.handlowiec }),
    pole({ name: 'sposob_pozyskania', label: 'Sposób pozyskania', typ: 'select', opcje: (sl.sposob_pozyskania || []).map(s => s.wartosc), wartosc: lead.sposob_pozyskania }),
    pole({ name: 'zrodlo_wiedzy_wpip', label: 'Źródło wiedzy o WPIP', typ: 'select', opcje: (sl.zrodlo_wiedzy_wpip || []).map(s => s.wartosc), wartosc: lead.zrodlo_wiedzy_wpip, pomoc: 'Zbierane dla wszystkich (potrzeba analityczna Marketingu)' }),
    pole({ name: 'prawd_kwalifikacji', label: '% szansy na kwalifikację', typ: 'number', min: 0, max: 100, wartosc: lead.prawd_kwalifikacji }),
    pole({ name: 'dobry_powod_kontaktu', label: 'Dobry powód kontaktu (PWE)', typ: 'textarea', wartosc: lead.dobry_powod_kontaktu, szerokie: true }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: lead.notatki, szerokie: true }));
  modal('Edytuj kontekst leada', form, [['Zapisz', 'btn-glowny', async () => {
    await PUT('/leady/' + lead.id, zbierzForm(form));
    toast('Zapisano'); odswiez();
  }]]);
}

async function pokazZos(lead) {
  const zos = await GET(`/leady/${lead.id}/zos`);
  const wiersze = [
    ['ID tematu', zos.id_tematu], ['Kontrahent', zos.kontrahent], ['NIP', zos.nip], ['Branża', zos.branza],
    ['Opiekun', zos.opiekun], ['Sposób pozyskania', zos.sposob_pozyskania], ['Źródło wiedzy o WPIP', zos.zrodlo_wiedzy_wpip],
    ['Proces researchu', zos.proces_researchu], ['Inwestycja', zos.inwestycja], ['Lokalizacja', zos.lokalizacja],
    ['Wartość inwestycji', zos.wartosc_inwestycji ? zos.wartosc_inwestycji + ' mln' : null], ['Etap', zos.etap],
    ['Osoba decyzyjna', zos.osoba_decyzyjna], ['Stanowisko', zos.stanowisko], ['E-mail', zos.email], ['Telefon', zos.telefon],
    ['Scoring', zos.scoring], ['Kwalifikacja wstępna', zos.kwalifikacja_wstepna], ['Status researchu', zos.status_researchu],
  ].filter(([, v]) => v);
  const tekst = wiersze.map(([k, v]) => `${k}: ${v}`).join('\n');
  const ta = el('textarea', { style: 'width:100%; min-height:280px; font-family:monospace; font-size:12px' }, tekst);
  modal('Pakiet handoff ZOS (krok 2 procesu E2E)', el('div', {},
    el('div', { class: 'info-box' }, 'Komplet danych do przekazania do Rejestru Zapytań / Intense przy rejestracji ZOS. Faza 1 integracji = ręczne przeniesienie (skopiuj poniżej).'),
    ta),
    [['Kopiuj do schowka', 'btn-glowny', async () => { await navigator.clipboard.writeText(tekst); toast('Skopiowano pakiet ZOS'); return false; }]]);
}

async function formularzLeada(grupy, sl, poZapisie) {
  if (!grupy.length) { toast('Najpierw utwórz grupę leadów (zakładka Scoring leadów)', true); return; }
  const { wersje, nazwy_komponentow } = await GET('/wersje');
  const wyboryBox = el('div', { class: 'form-siatka' });
  const wynikBox = el('div', { class: 'info-box' }, 'Wybierz opcje komponentów, aby zobaczyć scoring');

  function rysujWybory(grupaId) {
    const grupa = grupy.find(g => String(g.id) === String(grupaId));
    const wersja = wersje.find(w => w.id === grupa?.wersja_id);
    wyboryBox.innerHTML = '';
    if (!wersja) return;
    for (const [komp, opcje] of Object.entries(wersja.opcje)) {
      wyboryBox.append(pole({ name: 'wybor_' + komp, label: nazwy_komponentow[komp] || komp, typ: 'select', opcje: opcje.map(o => [o.etykieta, `${o.etykieta} (${o.punkty}${o.dyskwalifikacja ? ', X' : ''})`]), onchange: przelicz }));
    }
    function przelicz() {
      let total = 0, dysk = false;
      for (const s of wyboryBox.querySelectorAll('select')) {
        const komp = s.name.replace('wybor_', '');
        const o = (wersja.opcje[komp] || []).find(x => x.etykieta === s.value);
        if (o) { total += o.punkty; if (o.dyskwalifikacja) dysk = true; }
      }
      const p = dysk ? 'X' : total >= wersja.prog_a ? 'A' : total >= wersja.prog_b ? 'B' : total >= wersja.prog_c ? 'C' : 'D';
      wynikBox.textContent = `Scoring: ${total} pkt → priorytet ${p}${dysk ? ' (dyskwalifikacja)' : ''}`;
    }
  }
  rysujWybory(grupy[0].id);

  const form = el('div', {},
    el('div', { class: 'form-siatka' },
      pole({ name: 'nazwa', label: 'Nazwa leada', wymagane: true, szerokie: true }),
      pole({ name: 'grupa_id', label: 'Grupa', typ: 'select', pusta: false, wartosc: grupy[0].id, opcje: grupy.map(g => [g.id, g.nazwa]), onchange: (e) => rysujWybory(e.target.value) }),
      pole({ name: 'sposob_pozyskania', label: 'Sposób pozyskania', typ: 'select', opcje: (sl.sposob_pozyskania || []).map(s => s.wartosc) }),
      pole({ name: 'zrodlo_wiedzy_wpip', label: 'Źródło wiedzy o WPIP', typ: 'select', opcje: (sl.zrodlo_wiedzy_wpip || []).map(s => s.wartosc) }),
      pole({ name: 'handlowiec', label: 'Handlowiec', wartosc: 'Krystian' })),
    el('h2', { style: 'font-size:14px' }, 'Scoring (wg wersji grupy)'),
    wyboryBox, wynikBox,
    el('div', { class: 'form-siatka', style: 'margin-top:8px' },
      pole({ name: 'dobry_powod_kontaktu', label: 'Dobry powód kontaktu (PWE)', typ: 'textarea', szerokie: true })));

  modal('Nowy lead', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    const wybory = {};
    for (const [k, v] of Object.entries(d)) if (k.startsWith('wybor_') && v) wybory[k.replace('wybor_', '')] = v;
    const r = await POST('/leady', {
      nazwa: d.nazwa, grupa_id: d.grupa_id, sposob_pozyskania: d.sposob_pozyskania, zrodlo_wiedzy_wpip: d.zrodlo_wiedzy_wpip,
      handlowiec: d.handlowiec, dobry_powod_kontaktu: d.dobry_powod_kontaktu, wybory,
    });
    toast(`Lead zapisany: ${r.score_total} pkt → ${r.priorytet}`);
    poZapisie?.();
  }]]);
}
