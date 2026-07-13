// Pipeline v2: kanban per pipeline persony + temat prowadzony przez KAMIENIE MILOWE.
// Awans wylacznie przez potwierdzenie kamienia z dowodem (fakt po stronie klienta).
// Prawdopodobienstwo = ciagly potwierdzony prefiks. Biblioteka zadan per kamien.
import { GET, POST, PUT, slowniki, karty } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badgeStatus, badge, dataPl, mln, pct, pasekPrawd } from '../ui.js';
import { formularzDzialania, listaDzialan } from './dzialania.js';

export async function widokPipeline(kontener) {
  const [tematy, listaKart] = await Promise.all([GET('/tematy'), karty()]);
  const otwarte = tematy.filter(t => t.status === 'otwarty');
  const inne = tematy.filter(t => t.status !== 'otwarty');
  const wartoscW = otwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0) * t.prawdopodobienstwo / 100, 0);

  // Grupowanie po pipeline persony (kod)
  const kartaWg = Object.fromEntries(listaKart.map(k => [k.id, k]));
  const pipeliny = [...new Set(otwarte.map(t => t.karta_id))].map(id => kartaWg[id]).filter(Boolean);

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Pipeline sprzedażowy'),
        el('p', { class: 'podtytul' }, `${otwarte.length} tematów otwartych · wartość ważona ${mln(wartoscW)} PLN · awans tylko przez potwierdzenie kamienia z dowodem`)),
      el('div', { class: 'info-box', style: 'margin:0' }, 'Tematy powstają z leadów przez „Uruchom temat" (wejście na M1)')),

    pipeliny.length ? el('div', {}, ...pipeliny.map(karta => el('div', {},
      pipeliny.length > 1 ? el('h2', {}, karta.nazwa) : '',
      el('div', { class: 'kanban' },
        ...(karta.kamienie || []).map(km => {
          const wKol = otwarte.filter(t => t.kamien_id === km.id);
          const suma = wKol.reduce((s, t) => s + (t.wartosc_kontraktu || 0), 0);
          return el('div', { class: 'kanban-kolumna' },
            el('div', { class: 'kanban-naglowek' },
              el('span', {}, km.kod || km.nazwa.slice(0, 14)),
              el('span', { title: km.nazwa }, `${wKol.length}${suma ? ' · ' + mln(suma) : ''}`)),
            ...wKol.map(t => el('div', {
              class: 'kanban-karta', style: t.zastygly ? 'border-left-color:var(--zolty)' : '',
              onclick: () => location.hash = '#/tematy/' + t.id
            },
              el('div', { class: 'kk-id' }, t.identyfikator),
              el('div', { class: 'kk-info' },
                el('span', {}, t.klient_nazwa || '—'),
                el('span', {}, t.wartosc_kontraktu ? mln(t.wartosc_kontraktu) : '—')),
              el('div', { class: 'kk-info' },
                el('span', {}, pct(t.prawdopodobienstwo)),
                el('span', { style: t.zastygly ? 'color:var(--zolty); font-weight:700' : 'color:var(--tekst-2)' },
                  `${t.dni_w_etapie} dni${t.zastygly ? ' 🕒' : ''}`)),
              el('div', { style: 'margin-top:6px' }, pasekPrawd(t.prawdopodobienstwo)),
              t.status_e2e ? el('div', { class: 'kk-info', style: 'margin-top:6px' },
                el('span', { class: 'badge badge-nieb' }, '▶ ' + t.status_e2e)) : '')));
        }))))) : el('div', { class: 'karta-box puste' }, 'Brak otwartych tematów. Uruchom temat z zakwalifikowanego leada.'),

    inne.length ? el('div', {},
      el('h2', {}, 'Tematy zamknięte / w recyklingu'),
      tabela([
        { naglowek: 'Identyfikator', render: w => w.identyfikator },
        { naglowek: 'Klient', render: w => w.klient_nazwa || '—' },
        { naglowek: 'Wartość', klasa: 'liczba', render: w => mln(w.wartosc_kontraktu) },
        { naglowek: 'Status', render: w => badgeStatus(w.status) },
        { naglowek: 'Przyczyna', render: w => w.przyczyna_zamkniecia || '—' },
        { naglowek: 'Powrót', render: w => w.recycle_date ? dataPl(w.recycle_date) : '—' },
      ], inne, w => location.hash = '#/tematy/' + w.id)) : '',
  );
}

export async function widokTemat(kontener, id) {
  const [t, sl] = await Promise.all([GET('/tematy/' + id), slowniki()]);
  const odswiez = () => widokTemat((kontener.innerHTML = '', kontener), id);
  const otwarty = t.status === 'otwarty';
  const aktualnyKamien = t.kamienie.find(k => k.id === t.kamien_id);

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, t.identyfikator, ' ', badgeStatus(t.status), t.zastygly ? ' ' : '', t.zastygly ? badge(`zastygły ${t.dni_w_etapie} dni`, 'zolty') : ''),
        el('p', { class: 'podtytul' },
          `${t.klient_nazwa || ''} · ${t.karta_nazwa} · kamień ${t.kamien_kod || ''}: ${t.kamien_nazwa} · prawdopodobieństwo wygranej ${t.prawdopodobienstwo}%`)),
      el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap;' },
        el('button', { class: 'btn', onclick: () => formularzTematu(t, sl, odswiez) }, 'Edytuj dane'),
        otwarty && t.pipeline_kod === 'FAST_TRACK' && t.kamien_kod === 'F2'
          ? el('button', { class: 'btn', onclick: () => przeniesStandard(t, odswiez) }, '↦ Przenieś do STANDARD (M5)') : '',
        otwarty ? el('button', { class: 'btn btn-czerwony', onclick: () => zamknijTemat(t, odswiez) }, 'Zamknij temat') :
          el('button', { class: 'btn', onclick: async () => { await POST(`/tematy/${id}/otworz`); toast('Temat otwarty ponownie'); odswiez(); } }, 'Otwórz ponownie'))),

    t.status === 'recycled' ? el('div', { class: 'ostrzezenie' }, `Temat w recyklingu — powrót ${dataPl(t.recycle_date)}: ${t.przyczyna_zamkniecia || ''}`) : '',

    // --- Kamienie milowe (fakty klienta) ---
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Kamienie milowe — ', t.karta_nazwa),
      el('div', { class: 'info-box' }, 'Kamień = weryfikowalny FAKT po stronie klienta. Awans wyłącznie przez potwierdzenie z dowodem. Prawdopodobieństwo = najniższy nieosiągnięty kamień (M3↔M4 mogą być w dowolnej kolejności).'),
      el('div', { style: 'display:flex; flex-direction:column; gap:8px; margin-top:6px' },
        ...t.kamienie.map(km => wierszKamienia(km, t, otwarty, odswiez)))),

    // --- Biblioteka zadan aktualnego kamienia ---
    otwarty && aktualnyKamien ? el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Biblioteka zadań — ', aktualnyKamien.kod, ' ', el('span', { style: 'font-weight:400; color:var(--tekst-2)' }, aktualnyKamien.nazwa)),
      aktualnyKamien.definicja_spelnienia ? el('div', { class: 'info-box' }, 'Dowód spełnienia: ' + aktualnyKamien.definicja_spelnienia) : '',
      (t.szablony_kamienia || []).length ? el('div', {}, ...t.szablony_kamienia.map(s => wierszSzablonu(s, t, aktualnyKamien, odswiez)))
        : el('div', { class: 'puste', style: 'padding:12px' }, 'Brak zadań w bibliotece dla tego kamienia')) : '',

    // --- Dzialania ---
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Działania tematu'),
        otwarty ? el('button', { class: 'btn btn-maly btn-glowny', onclick: () => formularzDzialania({ temat_id: t.id, klient_id: t.klient_id, kamien_id: t.kamien_id }, odswiez) }, '+ Działanie własne') : null),
      listaDzialan(t.dzialania, odswiez)),

    // --- Dane tematu ---
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Dane tematu'),
      el('div', { class: 'szczegoly' },
        poz('Wartość kontraktu WPIP', mln(t.wartosc_kontraktu) + ' PLN'),
        poz('Marża planowana', pct(t.marza_pct)),
        poz('Model realizacji', t.model_realizacji || '—'),
        poz('Handlowiec', t.handlowiec || '—'),
        poz('Osoba kontaktowa', t.osoba_nazwa || '—'),
        poz('Termin złożenia oferty', dataPl(t.termin_oferty)),
        poz('Termin rozpoczęcia realizacji', dataPl(t.termin_realizacji)),
        poz('Czas trwania', t.czas_trwania_mies ? t.czas_trwania_mies + ' mies.' : '—'),
        poz('Źródło', t.zrodlo || '—'),
        poz('Lead źródłowy', t.lead_id ? el('a', { class: 'link', href: '#/leady/' + t.lead_id }, 'przejdź →') : '—')),
      t.notatki ? el('div', { style: 'margin-top:10px' }, poz('Notatki', t.notatki)) : null),

    // --- Status E2E (Intense) ---
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Status procesu ofertowego (E2E) ', badge('źródło: Intense', 'nieb')),
        el('div', { style: 'display:flex; gap:8px' },
          el('button', { class: 'btn btn-maly', onclick: () => pokazZos(t) }, 'Pakiet handoff (ZOS) →'),
          otwarty ? el('button', { class: 'btn btn-maly', onclick: () => aktualizujStatusE2e(t, sl, odswiez) }, 'Wpisz status (faza 1)') : null)),
      el('div', { class: 'info-box' }, 'Kroki 6–13 (kick-off, przygotowanie, Komitet Cenowy, Zarząd, wysyłka, wynik) prowadzi Intense — te pola są docelowo read-only ze źródłem w Intense. Faza 1 integracji: wpisywane ręcznie; faza 2: przez API.'),
      el('div', { class: 'szczegoly' },
        poz('Status E2E', t.status_e2e || '— nie rozpoczęto —'),
        poz('Wartość oferty', t.wartosc_oferty ? mln(t.wartosc_oferty) + ' PLN' : '—'),
        poz('Data decyzji', dataPl(t.data_decyzji_zwrotnej)),
        poz('Powód (odrzucenie/przegrana)', t.powod_zwrotny || '—'))),

    // --- Historia ---
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Historia zmian (audyt)'),
      tabela([
        { naglowek: 'Data', render: w => new Date(w.data + 'Z').toLocaleString('pl-PL') },
        { naglowek: 'Zmiana', render: w => w.typ_zmiany },
        { naglowek: 'Przed', render: w => w.wartosc_przed || '—' },
        { naglowek: 'Po', render: w => w.wartosc_po || '—' },
        { naglowek: 'Opis', render: w => w.opis || '—' },
      ], t.historia)),
  );
}

function wierszKamienia(km, t, otwarty, odswiez) {
  const aktualny = km.id === t.kamien_id;
  return el('div', {
    style: `display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border-radius:8px; border:1px solid var(--linia);`
      + (km.potwierdzony ? 'background:var(--zielony-tlo)' : aktualny ? 'background:var(--szary-tlo); border-color:var(--akcent)' : '')
  },
    el('div', {},
      el('div', {}, el('b', {}, km.kod), ' ', badge(km.prawd_start + '%', km.potwierdzony ? 'zielony' : 'szary'),
        aktualny && !km.potwierdzony ? ' ' : '', aktualny && !km.potwierdzony ? badge('aktualny', 'akcent') : '',
        km.potwierdzony ? ' ✓' : ''),
      el('div', { style: 'font-size:13px; margin-top:2px' }, km.nazwa),
      km.definicja_spelnienia ? el('div', { style: 'font-size:11px; color:var(--tekst-2); margin-top:2px' }, 'dowód: ' + km.definicja_spelnienia) : ''),
    otwarty ? el('div', { style: 'flex-shrink:0' },
      km.potwierdzony
        ? el('button', { class: 'btn btn-maly', onclick: () => cofnijKamien(t, km, odswiez) }, 'Cofnij')
        : el('button', { class: 'btn btn-maly btn-zielony', onclick: () => potwierdzKamien(t, km, odswiez) }, 'Potwierdź')) : '');
}

function wierszSzablonu(s, t, kamien, odswiez) {
  return el('div', { style: 'display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid var(--linia)' },
    el('div', {},
      el('div', { style: 'font-weight:600' }, s.typ ? badge(s.typ, 'szary') : '', ' ', s.nazwa),
      s.oczekiwany_efekt ? el('div', { style: 'font-size:12px; color:var(--tekst-2); margin-top:2px' }, '→ efekt: ' + s.oczekiwany_efekt) : ''),
    el('button', {
      class: 'btn btn-maly', style: 'flex-shrink:0', onclick: async () => {
        await POST('/dzialania', { temat_id: t.id, klient_id: t.klient_id, kamien_id: kamien.id, template_id: s.id, typ: s.typ, cel: s.nazwa, status: 'planowane' });
        toast('Dodano zadanie z biblioteki'); odswiez();
      }
    }, '+ zaplanuj'));
}

function potwierdzKamien(t, km, odswiez) {
  const dowod = el('textarea', { placeholder: km.definicja_spelnienia || 'Fakt po stronie klienta: notatka z rozmowy, data spotkania, dokument, link' });
  const kto = el('input', { value: t.handlowiec || '', placeholder: 'kto potwierdza' });
  modal(`Potwierdź kamień ${km.kod}`, el('div', {},
    el('div', { class: 'info-box' }, km.nazwa),
    el('div', { class: 'pole' }, el('label', {}, 'Dowód spełnienia *'), dowod),
    el('div', { class: 'pole', style: 'margin-top:8px' }, el('label', {}, 'Potwierdzający'), kto)),
    [['Potwierdź kamień', 'btn-zielony', async () => {
      if (!dowod.value.trim()) { toast('Dowód jest wymagany', true); return false; }
      const r = await POST(`/tematy/${t.id}/potwierdz-kamien`, { kamien_id: km.id, dowod: dowod.value, potwierdzajacy: kto.value || null });
      toast(r.f1_watch ? `Wygrana! F1-watch ${r.f1_watch.identyfikator} — przegląd za 6 mc` : `${km.kod} potwierdzony → ${r.prawdopodobienstwo}%`); odswiez();
    }]]);
}

function cofnijKamien(t, km, odswiez) {
  const powod = el('input', { placeholder: 'np. klient wycofał deklarację' });
  modal(`Cofnij potwierdzenie ${km.kod}`, el('div', { class: 'pole' }, el('label', {}, 'Powód cofnięcia *'), powod),
    [['Cofnij', 'btn-czerwony', async () => {
      if (!powod.value.trim()) { toast('Powód jest wymagany', true); return false; }
      const r = await POST(`/tematy/${t.id}/cofnij-kamien`, { kamien_id: km.id, powod: powod.value });
      toast(`Cofnięto → ${r.prawdopodobienstwo}%`); odswiez();
    }]]);
}

function poz(et, wa) {
  return el('div', { class: 'poz' }, el('div', { class: 'et' }, et), el('div', { class: 'wa' }, wa));
}

function formularzTematu(t, sl, poZapisie) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa tematu', wartosc: t.nazwa, szerokie: true }),
    pole({ name: 'wartosc_kontraktu', label: 'Wartość kontraktu WPIP (mln PLN)', typ: 'number', step: '0.1', wartosc: t.wartosc_kontraktu }),
    pole({ name: 'marza_pct', label: 'Marża planowana (%)', typ: 'number', step: '0.1', wartosc: t.marza_pct }),
    pole({ name: 'model_realizacji', label: 'Model realizacji', typ: 'select', wartosc: t.model_realizacji, opcje: (sl.model_realizacji || []).map(m => m.wartosc) }),
    pole({ name: 'co_budujemy', label: 'Co budujemy', wartosc: t.co_budujemy }),
    pole({ name: 'handlowiec', label: 'Handlowiec', wartosc: t.handlowiec }),
    pole({ name: 'termin_oferty', label: 'Termin złożenia oferty', typ: 'date', wartosc: t.termin_oferty }),
    pole({ name: 'termin_realizacji', label: 'Termin rozpoczęcia realizacji', typ: 'date', wartosc: t.termin_realizacji }),
    pole({ name: 'czas_trwania_mies', label: 'Czas trwania (mies.)', typ: 'number', wartosc: t.czas_trwania_mies }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: t.notatki, szerokie: true }));
  modal('Edytuj temat ' + t.identyfikator, form, [['Zapisz', 'btn-glowny', async () => {
    await PUT('/tematy/' + t.id, zbierzForm(form));
    toast('Temat zapisany'); poZapisie?.();
  }]]);
}

async function zamknijTemat(t, poZapisie) {
  const powody = await GET('/powody-zamkniecia?kamien_kod=' + encodeURIComponent(t.kamien_kod || ''));
  const wygrane = (await slowniki()).przyczyna_wygranej?.map(p => p.wartosc) || [];

  const przyczynaPole = el('div', { class: 'form-siatka' });
  function rysuj(status) {
    przyczynaPole.innerHTML = '';
    if (status === 'wygrany') {
      przyczynaPole.append(pole({ name: 'przyczyna', label: 'Przyczyna wygranej (obowiązkowa)', typ: 'select', opcje: wygrane, wymagane: true }));
    } else if (status === 'przegrany' || status === 'odrzucony') {
      przyczynaPole.append(pole({
        name: 'powod_id', label: `Powód (słownik dla etapu ${t.kamien_kod || ''}) — recyklingowalny wróci automatycznie`,
        typ: 'select', wymagane: true, opcje: powody.map(p => [p.id, p.nazwa + (p.czy_recyklingowalny ? ` ♻ +${p.offset_powrotu_mies}mc` : '')])
      }));
    }
  }

  const form = el('div', {},
    el('div', { class: 'form-siatka' },
      pole({
        name: 'status', label: 'Status zamknięcia', typ: 'select', pusta: false,
        opcje: [['wygrany', 'Wygrany — umowa podpisana'], ['przegrany', 'Przegrany'], ['odrzucony', 'Odrzucony (my rezygnujemy)'], ['wstrzymany', 'Wstrzymany']],
        onchange: e => rysuj(e.target.value),
      })),
    el('div', { style: 'height:8px' }), przyczynaPole,
    el('div', { class: 'form-siatka', style: 'margin-top:8px' },
      pole({ name: 'opis', label: 'Kontekst / czego się uczymy', typ: 'textarea', szerokie: true })));
  rysuj('wygrany');

  modal('Zamknięcie tematu ' + t.identyfikator, form, [['Zamknij temat', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    const r = await POST(`/tematy/${t.id}/zamknij`, d);
    if (r.recycled) toast(`Temat w recyklingu — powrót ${r.recycle_date}`);
    else if (r.f1_watch) toast(`Wygrana! Utworzono F1-watch ${r.f1_watch.identyfikator} — przegląd konta za 6 mc`);
    else toast('Temat zamknięty: ' + d.status);
    poZapisie?.();
  }]]);
}

function przeniesStandard(t, poZapisie) {
  const powod = el('textarea', { placeholder: 'np. klient ogłosił szeroki przetarg (>3 oferentów) bez deklaracji kontynuacji' });
  modal('Przenieś do pipeline STANDARD (M5)', el('div', {},
    el('div', { class: 'info-box' }, 'Temat trafi na kamień M5 STANDARD z zachowaniem ID i historii. M1–M4 zostaną auto-potwierdzone (klient przeszedł kwalifikację w fast-tracku).'),
    el('div', { class: 'pole' }, el('label', {}, 'Powód przeniesienia *'), powod)),
    [['Przenieś', 'btn-glowny', async () => {
      if (!powod.value.trim()) { toast('Powód jest wymagany', true); return false; }
      const r = await POST(`/tematy/${t.id}/przenies-standard`, { powod: powod.value });
      toast(`Przeniesiony do STANDARD M5 → ${r.prawdopodobienstwo}%`); poZapisie?.();
    }]]);
}

async function pokazZos(t) {
  const z = await GET(`/tematy/${t.id}/zos`);
  const wiersze = [
    ['ID tematu', z.id_tematu], ['Kontrahent', z.kontrahent], ['NIP', z.nip], ['Branża', z.branza],
    ['Opiekun', z.opiekun], ['Sposób pozyskania', z.sposob_pozyskania], ['Źródło wiedzy o WPIP', z.zrodlo_wiedzy_wpip],
    ['Inwestycja', z.inwestycja], ['Lokalizacja', z.lokalizacja],
    ['Wartość inwestycji', z.wartosc_inwestycji ? z.wartosc_inwestycji + ' mln' : null],
    ['Wartość kontraktu WPIP', z.wartosc_kontraktu ? z.wartosc_kontraktu + ' mln' : null],
    ['Model realizacji', z.model_realizacji], ['Etap', z.etap],
    ['Osoba decyzyjna', z.osoba_decyzyjna], ['Stanowisko', z.stanowisko], ['E-mail', z.email], ['Telefon', z.telefon],
    ['Scoring', z.scoring],
  ].filter(([, v]) => v);
  const tekst = wiersze.map(([k, v]) => `${k}: ${v}`).join('\n');
  const ta = el('textarea', { style: 'width:100%; min-height:280px; font-family:monospace; font-size:12px' }, tekst);
  modal('Pakiet handoff do ZOS / Intense', el('div', {},
    el('div', { class: 'info-box' }, 'Komplet danych CRM → Intense przy rejestracji ZOS (krok 2 modelu integracji). Faza 1: skopiuj poniżej.'), ta),
    [['Kopiuj do schowka', 'btn-glowny', async () => { await navigator.clipboard.writeText(tekst); toast('Skopiowano pakiet handoff'); return false; }]]);
}

function aktualizujStatusE2e(t, sl, poZapisie) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'status_e2e', label: 'Status procesu (z Intense)', typ: 'select', wartosc: t.status_e2e, opcje: (sl.status_e2e || []).map(s => s.wartosc) }),
    pole({ name: 'wartosc_oferty', label: 'Wartość oferty (mln PLN)', typ: 'number', step: '0.1', wartosc: t.wartosc_oferty }),
    pole({ name: 'data_decyzji', label: 'Data decyzji', typ: 'date', wartosc: t.data_decyzji_zwrotnej }),
    pole({ name: 'powod', label: 'Powód (odrzucenie / przegrana)', typ: 'textarea', wartosc: t.powod_zwrotny, szerokie: true }));
  modal('Status zwrotny z procesu ofertowego', form, [['Zapisz', 'btn-glowny', async () => {
    await POST(`/tematy/${t.id}/status-e2e`, zbierzForm(form));
    toast('Status E2E zaktualizowany'); poZapisie?.();
  }]]);
}
