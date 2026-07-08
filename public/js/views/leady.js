// Leady - sciezka procesu pozyskania tematu (Lead surowy -> ... -> Zakwalifikowany -> Komitet)
// Os prawdopodobienstwa: "% szansy na KWALIFIKACJE" (nie mylic z % wygranej tematu)
import { GET, POST, slowniki } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badgePriorytet, badgeStatus, badge, dataPl, pct } from '../ui.js';
import { formularzDzialania, listaDzialan } from './dzialania.js';

const KOLORY_RESEARCHU = { SZARY: 'szary', ZIELONY: 'zielony', 'ŻÓŁTY': 'zolty', CZERWONY: 'czerwony' };

export function badgeResearch(s) {
  return s ? badge('R: ' + s, KOLORY_RESEARCHU[s] || 'szary') : '';
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
      // Kanban sciezki pozyskania tematu (tylko aktywne maja sens w kolumnach)
      box.append(el('div', { class: 'kanban' },
        ...kamienie.map(kamien => {
          const wKolumnie = dane.filter(l => l.kamien === kamien);
          return el('div', { class: 'kanban-kolumna' },
            el('div', { class: 'kanban-naglowek' },
              el('span', {}, kamien), el('span', {}, String(wKolumnie.length))),
            ...wKolumnie.map(l => el('div', {
              class: 'kanban-karta', style: l.dyskwalifikacja_x ? 'border-left-color:var(--czerwony)' : '',
              onclick: () => location.hash = '#/leady/' + l.id
            },
              el('div', { class: 'kk-id' }, l.nazwa.slice(0, 60)),
              el('div', { class: 'kk-info' },
                el('span', {}, badgePriorytet(l.priorytet), ' ', String(l.score_total), ' pkt'),
                el('span', {}, badgeResearch(l.status_researchu))),
              el('div', { class: 'kk-info' },
                el('span', {}, l.wojewodztwo || ''),
                el('span', {}, l.dzialania_otwarte ? `${l.dzialania_otwarte} dział.` : '')))));
        })));
    } else {
      box.append(tabela([
        { naglowek: 'Prio', klasa: 'wysrodkuj', render: w => badgePriorytet(w.priorytet) },
        { naglowek: 'Scoring', klasa: 'liczba', render: w => String(w.score_total) },
        { naglowek: 'Lead', render: w => w.nazwa },
        { naglowek: 'Grupa', render: w => w.grupa_nazwa || '—' },
        { naglowek: 'Kamień ścieżki', render: w => w.kamien },
        { naglowek: 'Research', render: w => badgeResearch(w.status_researchu) },
        { naglowek: '% kwalif.', klasa: 'liczba', render: w => pct(w.prawd_kwalifikacji) },
        { naglowek: 'Status', render: w => badgeStatus(w.status) },
        { naglowek: 'Wystąp.', klasa: 'wysrodkuj', render: w => w.liczba_wystapien ? String(1 + w.liczba_wystapien) : '1' },
      ], dane, w => location.hash = '#/leady/' + w.id));
    }
  }
  rysuj();

  const filtrSelect = (etykieta, opcje, ustaw, wybrane = '') => {
    const s = el('select', { onchange: e => { ustaw(e.target.value); rysuj(); } },
      el('option', { value: '' }, etykieta),
      ...opcje.map(o => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return el('option', { value: val, selected: String(val) === String(wybrane) }, label);
      }));
    return s;
  };

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Leady / Prospecting'),
        el('p', { class: 'podtytul' }, 'Ścieżka pozyskania tematu: Lead surowy → Research → … → Zakwalifikowany → Komitet Ofertowy')),
      el('button', { class: 'btn btn-glowny', onclick: () => formularzLeada(grupy, sl, () => location.reload()) }, '+ Nowy lead')),
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

export async function widokLead(kontener, id) {
  const [lead, sl] = await Promise.all([GET('/leady/' + id), slowniki()]);
  const odswiez = () => widokLead((kontener.innerHTML = '', kontener), id);
  const kamienie = lead.kamienie;
  const aktIdx = kamienie.indexOf(lead.kamien);
  const aktywny = lead.status === 'aktywny';

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, lead.nazwa, ' ', badgePriorytet(lead.priorytet), ' ', badgeStatus(lead.status)),
        el('p', { class: 'podtytul' },
          `Grupa: ${lead.grupa_nazwa || '—'} · scoring ${lead.score_total} pkt (${lead.wersja_nazwa || 'brak wersji'}) · `,
          `% szansy na kwalifikację: ${lead.prawd_kwalifikacji}%`)),
      el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap' },
        aktywny ? el('button', {
          class: 'btn', onclick: () => zmienStatus(lead, 'uspiony', sl, odswiez)
        }, 'Uśpij (nurture)') : '',
        aktywny ? el('button', {
          class: 'btn btn-czerwony', onclick: () => zmienStatus(lead, 'odpuszczony', sl, odswiez)
        }, 'Odpuść') : '',
        !aktywny && !lead.temat_id ? el('button', {
          class: 'btn', onclick: async () => { await POST(`/leady/${id}/status`, { status: 'aktywny' }); toast('Lead przywrócony'); odswiez(); }
        }, 'Przywróć do aktywnych') : '',
        lead.temat_id ? el('a', { class: 'btn btn-zielony', href: '#/tematy/' + lead.temat_id }, 'Przejdź do tematu →') : '')),

    lead.dyskwalifikacja_x ? el('div', { class: 'ostrzezenie' }, '⛔ Dyskwalifikacja (X): ', lead.dyskwalifikacja_powod || '') : '',
    lead.status === 'odpuszczony' ? el('div', { class: 'ostrzezenie' }, 'Lead odpuszczony: ', lead.powod_odpuszczenia || '') : '',

    // ---- Sciezka ----
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Ścieżka pozyskania tematu'),
      el('div', { class: 'info-box' },
        'Przejście = Twoja decyzja. Lead priorytetu A wymaga researchu (ZIELONY/ŻÓŁTY) przed wyjściem poza „Research". „Zakwalifikowany" kieruje leada do kolejki Komitetu Ofertowego.'),
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

    // ---- Research ----
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Research (weryfikacja KRS / web) — ', badgeResearch(lead.status_researchu)),
      el('div', { class: 'info-box' },
        'ZIELONY = potwierdzony dobry lead · ŻÓŁTY = istotny czynnik ryzyka (obowiązkowa notatka, np. „stały GW Takenaka") · CZERWONY = dyskwalifikacja post-research · SZARY = wymaga weryfikacji'),
      el('div', { class: 'filtry' },
        ...['ZIELONY', 'ŻÓŁTY', 'CZERWONY', 'SZARY'].map(s => el('button', {
          class: 'btn btn-maly' + (lead.status_researchu === s ? ' btn-glowny' : ''),
          onclick: () => {
            const notatkaInput = el('textarea', { placeholder: s === 'ŻÓŁTY' ? 'Czynnik ryzyka (obowiązkowe)' : 'Notatka z researchu (opcjonalna)' }, lead.research_notatka || '');
            modal(`Research: ${s}`, el('div', { class: 'pole' }, el('label', {}, 'Notatka'), notatkaInput),
              [['Zapisz', 'btn-glowny', async () => {
                await POST(`/leady/${id}/research`, { status: s, notatka: notatkaInput.value || null });
                if (s === 'CZERWONY') toast('CZERWONY — rozważ odpuszczenie leada (przycisk „Odpuść")');
                else toast('Research: ' + s);
                odswiez();
              }]]);
          }
        }, s))),
      lead.research_notatka ? el('p', { style: 'margin:8px 0 0' }, el('b', {}, 'Notatka: '), lead.research_notatka) : ''),

    // ---- Scoring (wybory komponentow) ----
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, `Scoring — ${lead.score_total} pkt → priorytet ${lead.priorytet}`),
      el('div', { class: 'info-box' },
        `Wersja: ${lead.wersja_nazwa || '—'} (progi A ≥ ${lead.prog_a ?? '—'} · B ≥ ${lead.prog_b ?? '—'} · C ≥ ${lead.prog_c ?? '—'}). Zmiana wyboru (reklasyfikacja) przelicza scoring automatycznie i zapisuje się w historii.`),
      el('div', { class: 'form-siatka' },
        ...Object.entries(lead.opcje_wersji).map(([komp, opcje]) => {
          const wybor = lead.wybory[komp];
          const opcja = opcje.find(o => o.etykieta === wybor);
          return el('div', { class: 'pole' },
            el('label', {}, `${komp} (${opcja ? opcja.punkty + ' pkt' : 'brak wyboru'})${opcja?.dyskwalifikacja ? ' ⛔' : ''}`),
            el('select', {
              onchange: async (e) => {
                try {
                  const r = await POST(`/leady/${id}/wybory`, { komponent: komp, etykieta: e.target.value });
                  toast(`Przeliczono: ${r.score_total} pkt → ${r.priorytet}`);
                  odswiez();
                } catch (err) { toast(err.message, true); odswiez(); }
              }
            },
              el('option', { value: '', selected: !wybor }, '— brak wyboru —'),
              ...opcje.map(o => el('option', { value: o.etykieta, selected: o.etykieta === wybor },
                `${o.etykieta} (${o.punkty}${o.dyskwalifikacja ? ', X' : ''})`))));
        }))),

    // ---- Kontekst handlowy ----
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Kontekst handlowy (PWE)'),
        el('button', { class: 'btn btn-maly', onclick: () => edytujKontekst(lead, odswiez) }, 'Edytuj')),
      el('div', { class: 'szczegoly' },
        poz('Klient', lead.klient_nazwa ? el('a', { class: 'link', href: '#/klienci/' + lead.klient_id }, lead.klient_nazwa) : '—'),
        poz('Osoba kontaktowa', lead.osoba_nazwa || '—'),
        poz('Inwestycja', lead.inwestycja_nazwa || '—'),
        poz('Etap (z inwestycji)', lead.etap_projektu || '—'),
        poz('Wartość inwestycji', lead.wartosc_inwestycji ? lead.wartosc_inwestycji + ' mln' : '—'),
        poz('Lokalizacja', [lead.inwestycja_miasto, lead.wojewodztwo].filter(Boolean).join(', ') || '—'),
        poz('Źródło', lead.zrodlo || '—'),
        poz('Handlowiec', lead.handlowiec || '—')),
      el('div', { style: 'margin-top:10px' },
        poz('Dobry powód kontaktu (PWE)', lead.dobry_powod_kontaktu || '— uzupełnij przed pierwszym kontaktem —'),
        el('div', { style: 'height:8px' }),
        poz('Notatki', lead.notatki || '—'))),

    // ---- Wystapienia ----
    lead.wystapienia.length ? el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Wystąpienia w innych bazach'),
      tabela([
        { naglowek: 'Data', render: w => dataPl(w.data) },
        { naglowek: 'Grupa', render: w => w.grupa_nazwa || '—' },
        { naglowek: 'Notatka', render: w => w.notatka || '—' },
      ], lead.wystapienia)) : '',

    // ---- Dzialania ----
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Działania (sekwencja kontaktu)'),
        el('button', { class: 'btn btn-maly', onclick: () => formularzDzialania({ lead_id: lead.id, klient_id: lead.klient_id }, odswiez) }, '+ Działanie')),
      listaDzialan(lead.dzialania, odswiez)),

    // ---- Historia ----
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
        { naglowek: 'Uzasadnienie', render: w => w.uzasadnienie || '—' },
      ], lead.decyzje)) : '',
  );
}

function poz(et, wa) {
  return el('div', { class: 'poz' }, el('div', { class: 'et' }, et), el('div', { class: 'wa' }, wa));
}

export function badgeDecyzja(d) {
  const mapa = { bid: ['BID — ofertujemy', 'zielony'], no_bid: ['NO BID — odpuszczamy', 'czerwony'], defer: ['DEFER — dopytujemy', 'zolty'] };
  const [t, k] = mapa[d] || [d, 'szary'];
  return el('span', { class: 'badge badge-' + k }, t);
}

function zmienStatus(lead, status, sl, odswiez) {
  if (status === 'uspiony') {
    modal('Uśpienie leada (nurture)', el('p', {}, 'Lead trafi do uśpionych — obserwuj/grzej, wróć gdy pojawi się sygnał.'),
      [['Uśpij', 'btn-glowny', async () => {
        await POST(`/leady/${lead.id}/status`, { status: 'uspiony' });
        toast('Lead uśpiony'); odswiez();
      }]]);
  } else {
    const powody = (sl.powod_odpuszczenia || []).map(p => p.wartosc);
    const form = el('div', { class: 'form-siatka' },
      pole({ name: 'powod', label: 'Powód odpuszczenia (obowiązkowy)', typ: 'select', opcje: powody, wymagane: true }));
    modal('Odpuszczenie leada', form, [['Odpuść', 'btn-czerwony', async () => {
      const d = zbierzForm(form);
      if (!d.powod) { toast('Powód jest obowiązkowy', true); return false; }
      await POST(`/leady/${lead.id}/status`, { status: 'odpuszczony', powod: d.powod });
      toast('Lead odpuszczony'); odswiez();
    }]]);
  }
}

function edytujKontekst(lead, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa leada', wartosc: lead.nazwa, szerokie: true }),
    pole({ name: 'handlowiec', label: 'Handlowiec', wartosc: lead.handlowiec }),
    pole({ name: 'prawd_kwalifikacji', label: '% szansy na kwalifikację', typ: 'number', min: 0, max: 100, wartosc: lead.prawd_kwalifikacji, pomoc: 'Oś LEADY — to nie jest % wygranej' }),
    pole({ name: 'dobry_powod_kontaktu', label: 'Dobry powód kontaktu (PWE)', typ: 'textarea', wartosc: lead.dobry_powod_kontaktu, szerokie: true }),
    pole({ name: 'pwe', label: 'PWE / problem klienta', typ: 'textarea', wartosc: lead.pwe, szerokie: true }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: lead.notatki, szerokie: true }));
  modal('Edytuj kontekst leada', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    await (await import('../api.js')).PUT('/leady/' + lead.id, d);
    toast('Zapisano'); odswiez();
  }]]);
}

// Reczne dodanie leada: wybor grupy -> wybory komponentow z wersji grupy
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
      wyboryBox.append(pole({
        name: 'wybor_' + komp, label: nazwy_komponentow[komp] || komp, typ: 'select',
        opcje: opcje.map(o => [o.etykieta, `${o.etykieta} (${o.punkty}${o.dyskwalifikacja ? ', X' : ''})`]),
        onchange: przelicz,
      }));
    }
    function przelicz() {
      let total = 0, dysk = false;
      for (const selectEl of wyboryBox.querySelectorAll('select')) {
        const komp = selectEl.name.replace('wybor_', '');
        const o = (wersja.opcje[komp] || []).find(x => x.etykieta === selectEl.value);
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
      pole({
        name: 'grupa_id', label: 'Grupa', typ: 'select', pusta: false, wartosc: grupy[0].id,
        opcje: grupy.map(g => [g.id, g.nazwa]), onchange: (e) => rysujWybory(e.target.value)
      }),
      pole({ name: 'zrodlo', label: 'Źródło', typ: 'select', opcje: (sl.zrodlo_leada || []).map(z => z.wartosc) }),
      pole({ name: 'handlowiec', label: 'Handlowiec', wartosc: 'Krystian' })),
    el('h2', { style: 'font-size:14px' }, 'Scoring (wg wersji grupy)'),
    wyboryBox, wynikBox,
    el('div', { class: 'form-siatka', style: 'margin-top:8px' },
      pole({ name: 'dobry_powod_kontaktu', label: 'Dobry powód kontaktu (PWE)', typ: 'textarea', szerokie: true }),
      pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', szerokie: true })));

  modal('Nowy lead', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    const wybory = {};
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('wybor_') && v) wybory[k.replace('wybor_', '')] = v;
    }
    const r = await POST('/leady', {
      nazwa: d.nazwa, grupa_id: d.grupa_id, zrodlo: d.zrodlo, handlowiec: d.handlowiec,
      dobry_powod_kontaktu: d.dobry_powod_kontaktu, notatki: d.notatki, wybory,
    });
    toast(`Lead zapisany: ${r.score_total} pkt → ${r.priorytet}`);
    poZapisie?.();
  }]]);
}
