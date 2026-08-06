// Edytor lejkow sprzedazy (zarzadzanie jak w Livespace): lejki -> kamienie-fakty ->
// kryteria (checklista, twarda bramka) + biblioteka zadan + powody zamkniecia. Wszystko jako dane.
import { GET, POST, PUT, DEL, invalidateCache } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badge } from '../ui.js';

export async function widokLejki(kontener) {
  const lejki = await GET('/lejki');
  const odswiez = () => widokLejki((kontener.innerHTML = '', kontener));

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Lejki sprzedaży'),
        el('p', { class: 'podtytul' }, 'Definicje lejków to dane, nie kod: kamienie-fakty z pasmami %, kryteria (twarda checklista), biblioteka zadań i powody zamknięcia — wszystko edytowalne tutaj.')),
      el('button', { class: 'btn btn-glowny', onclick: () => formularzLejka(null, odswiez) }, '+ Nowy lejek')),
    ...lejki.map(l => kartaLejka(l, odswiez)));
}

function kartaLejka(l, odswiez) {
  return el('div', { class: 'karta-box' },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0' }, l.nazwa, ' ',
        l.kod ? badge(l.kod, 'nieb') : '', ' ',
        l.persona ? badge(l.persona, 'szary') : ''),
      el('div', { style: 'display:flex; gap:8px; align-items:center' },
        el('span', { style: 'color:var(--tekst-2); font-size:12px' }, `${l.liczba_tematow} tematów`),
        el('button', { class: 'btn btn-maly', onclick: () => formularzLejka(l, odswiez) }, 'Edytuj lejek'),
        el('button', { class: 'btn btn-maly', onclick: () => formularzKamienia(l, null, odswiez) }, '+ Kamień'))),
    l.opis ? el('p', { style: 'color:var(--tekst-2); margin:4px 0 10px' }, l.opis) : '',
    el('div', { style: 'display:flex; flex-direction:column; gap:8px' },
      ...l.kamienie.map(km => wierszKamienia(l, km, odswiez))));
}

function wierszKamienia(lejek, km, odswiez) {
  const szczegoly = el('div', { style: 'display:none; margin-top:10px; padding-top:10px; border-top:1px dashed var(--linia)' });
  let zaladowane = false;
  function przelacz() {
    if (szczegoly.style.display === 'none') {
      if (!zaladowane) { szczegoly.append(sekcjaSzczegolow(km, odswiez)); zaladowane = true; }
      szczegoly.style.display = '';
    } else szczegoly.style.display = 'none';
  }
  return el('div', { style: 'border:1px solid var(--linia); border-radius:10px; padding:10px 14px' },
    el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; cursor:pointer', onclick: przelacz },
      el('div', {},
        el('b', {}, km.kod || '#' + km.kolejnosc), ' ',
        badge(`${km.prawd_min}–${km.prawd_max}% (start ${km.prawd_start})`, 'szary'), ' ',
        km.prog_zastygniecia_dni ? badge(`🕒 ${km.prog_zastygniecia_dni} dni`, 'zolty') : '',
        km.elastyczna_kolejnosc ? badge('elastyczna kolejność', 'nieb') : '',
        el('div', { style: 'font-size:13px; margin-top:3px' }, km.nazwa)),
      el('div', { style: 'display:flex; gap:6px; align-items:center; flex-shrink:0' },
        el('span', { style: 'font-size:11px; color:var(--tekst-2)' },
          `${km.kryteria.length} kryt. · ${km.zadania.length} zad. · ${km.powody.length} pow.`),
        el('button', { class: 'btn btn-maly', onclick: (e) => { e.stopPropagation(); formularzKamienia(lejek, km, odswiez); } }, 'Edytuj'),
        el('button', {
          class: 'btn btn-maly btn-czerwony', title: 'usuń (tylko nieużywany)',
          onclick: async (e) => {
            e.stopPropagation();
            try { await DEL('/kamienie/' + km.id); toast('Kamień usunięty'); odswiez(); }
            catch (err) { toast(err.message, true); }
          }
        }, '×'))),
    szczegoly);
}

function sekcjaSzczegolow(km, odswiez) {
  return el('div', { style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px' },
    // Kryteria (twarda checklista)
    el('div', {},
      el('h2', { style: 'font-size:13px; margin:0 0 6px' }, 'Kryteria (checklista — twarda bramka)'),
      ...km.kryteria.map(kr => el('div', { style: 'display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px solid var(--linia); font-size:13px' },
        el('span', {}, kr.obowiazkowe ? el('b', { style: 'color:var(--czerwony)' }, '* ') : '', kr.tekst),
        el('button', { class: 'btn btn-maly btn-czerwony', onclick: async () => { await DEL('/kryteria/' + kr.id); toast('Usunięto'); odswiez(); } }, '×'))),
      el('button', {
        class: 'btn btn-maly', style: 'margin-top:6px', onclick: () => {
          const form = el('div', { class: 'form-siatka' },
            pole({ name: 'tekst', label: 'Treść kryterium (fakt do odhaczenia)', wymagane: true, szerokie: true }),
            pole({ name: 'obowiazkowe', label: 'Obowiązkowe?', typ: 'select', pusta: false, opcje: [[1, 'Tak — blokuje potwierdzenie'], [0, 'Nie — informacyjne']] }));
          modal('Nowe kryterium — ' + (km.kod || km.nazwa), form, [['Dodaj', 'btn-glowny', async () => {
            const d = zbierzForm(form);
            if (!d.tekst) { toast('Treść wymagana', true); return false; }
            await POST(`/kamienie/${km.id}/kryteria`, d); toast('Dodano'); odswiez();
          }]]);
        }
      }, '+ kryterium')),
    // Biblioteka zadan
    el('div', {},
      el('h2', { style: 'font-size:13px; margin:0 0 6px' }, 'Biblioteka zadań'),
      ...km.zadania.map(z => el('div', { style: 'display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px solid var(--linia); font-size:13px' },
        el('span', {}, z.typ ? badge(z.typ, 'szary') : '', ' ', z.nazwa,
          z.oczekiwany_efekt ? el('div', { style: 'font-size:11px; color:var(--tekst-2)' }, '→ ' + z.oczekiwany_efekt) : ''),
        el('div', { style: 'display:flex; gap:4px; flex-shrink:0' },
          el('button', { class: 'btn btn-maly', onclick: () => formularzZadania(km, z, odswiez) }, '✎'),
          el('button', { class: 'btn btn-maly btn-czerwony', onclick: async () => { await DEL('/zadania-szablony/' + z.id); toast('Usunięto'); odswiez(); } }, '×')))),
      el('button', { class: 'btn btn-maly', style: 'margin-top:6px', onclick: () => formularzZadania(km, null, odswiez) }, '+ zadanie')),
    // Powody zamkniecia
    el('div', {},
      el('h2', { style: 'font-size:13px; margin:0 0 6px' }, 'Powody zamknięcia na tym etapie'),
      ...km.powody.map(p => el('div', { style: 'display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px solid var(--linia); font-size:13px' },
        el('span', {}, p.nazwa, p.czy_recyklingowalny ? ' ' : '', p.czy_recyklingowalny ? badge(`♻ +${p.offset_powrotu_mies}mc`, 'zolty') : ''),
        el('button', { class: 'btn btn-maly btn-czerwony', onclick: async () => { await DEL('/powody-zamkniecia/' + p.id); toast('Usunięto'); odswiez(); } }, '×'))),
      el('button', {
        class: 'btn btn-maly', style: 'margin-top:6px', onclick: () => {
          const form = el('div', { class: 'form-siatka' },
            pole({ name: 'nazwa', label: 'Powód', wymagane: true, szerokie: true }),
            pole({ name: 'czy_recyklingowalny', label: 'Recyklingowalny?', typ: 'select', pusta: false, opcje: [[0, 'Nie — strata definitywna'], [1, 'Tak — temat wróci']] }),
            pole({ name: 'offset_powrotu_mies', label: 'Powrót za (miesięcy)', typ: 'number', wartosc: 6 }));
          modal('Nowy powód — ' + (km.kod || km.nazwa), form, [['Dodaj', 'btn-glowny', async () => {
            const d = zbierzForm(form);
            if (!d.nazwa) { toast('Powód wymagany', true); return false; }
            await POST('/powody-zamkniecia', { ...d, kamien_kod: km.kod }); toast('Dodano'); odswiez();
          }]]);
        }
      }, '+ powód')));
}

function formularzLejka(l, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa lejka', wymagane: true, wartosc: l?.nazwa, szerokie: true, placeholder: 'np. Deweloper magazynowy' }),
    pole({ name: 'kod', label: 'Kod (unikalny, np. DEWELOPER)', wartosc: l?.kod }),
    pole({ name: 'persona', label: 'Persona / segment', wartosc: l?.persona }),
    pole({ name: 'opis', label: 'Opis', typ: 'textarea', wartosc: l?.opis, szerokie: true }));
  modal(l ? 'Edytuj lejek' : 'Nowy lejek sprzedaży', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    if (l) await PUT('/karty/' + l.id, d);
    else await POST('/karty', d).then(r => PUT('/karty/' + r.id, d));
    invalidateCache(); toast('Lejek zapisany'); odswiez();
  }]]);
}

function formularzKamienia(lejek, km, odswiez) {
  const ostatni = lejek.kamienie[lejek.kamienie.length - 1];
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Kamień = fakt po stronie klienta', wymagane: true, wartosc: km?.nazwa, szerokie: true, placeholder: 'np. Standard techniczny dewelopera potwierdzony' }),
    pole({ name: 'kod', label: 'Kod (np. D1)', wartosc: km?.kod }),
    pole({ name: 'prawd_min', label: 'Pasmo od (%)', typ: 'number', wartosc: km?.prawd_min ?? (ostatni ? ostatni.prawd_max + 1 : 0) }),
    pole({ name: 'prawd_max', label: 'Pasmo do (%)', typ: 'number', wartosc: km?.prawd_max }),
    pole({ name: 'prawd_start', label: 'Start (%) po potwierdzeniu', typ: 'number', wartosc: km?.prawd_start }),
    pole({ name: 'kolejnosc', label: 'Kolejność', typ: 'number', wartosc: km?.kolejnosc ?? (ostatni ? ostatni.kolejnosc + 1 : 1) }),
    pole({ name: 'prog_zastygniecia_dni', label: 'Próg zastygnięcia (dni)', typ: 'number', wartosc: km?.prog_zastygniecia_dni }),
    pole({ name: 'elastyczna_kolejnosc', label: 'Elastyczna kolejność?', typ: 'select', pusta: false, wartosc: km?.elastyczna_kolejnosc ?? 0, opcje: [[0, 'Nie'], [1, 'Tak (jak M3↔M4)']] }),
    pole({ name: 'definicja_spelnienia', label: 'Definicja dowodu spełnienia', typ: 'textarea', wartosc: km?.definicja_spelnienia, szerokie: true }));
  modal((km ? 'Edytuj kamień — ' : 'Nowy kamień — ') + lejek.nazwa, form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    try {
      if (km) await PUT('/kamienie/' + km.id, d);
      else await POST(`/karty/${lejek.id}/kamienie`, d);
      invalidateCache(); toast('Kamień zapisany'); odswiez();
    } catch (e) { toast(e.message, true); return false; }
  }]]);
}

function formularzZadania(km, z, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Zadanie', wymagane: true, wartosc: z?.nazwa, szerokie: true }),
    pole({ name: 'typ', label: 'Typ', typ: 'select', wartosc: z?.typ, opcje: ['telefon', 'mail', 'spotkanie', 'research', 'wizyta', 'warsztat', 'inne'] }),
    pole({ name: 'oczekiwany_efekt', label: 'Oczekiwany efekt (sukces)', wartosc: z?.oczekiwany_efekt, szerokie: true }),
    pole({ name: 'co_dalej_sukces', label: 'Co dalej przy sukcesie', wartosc: z?.co_dalej_sukces }),
    pole({ name: 'co_dalej_porazka', label: 'Co dalej przy porażce', wartosc: z?.co_dalej_porazka }));
  modal((z ? 'Edytuj zadanie — ' : 'Nowe zadanie — ') + (km.kod || km.nazwa), form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    if (z) await PUT('/zadania-szablony/' + z.id, d);
    else await POST(`/kamienie/${km.id}/zadania`, d);
    toast('Zapisano'); odswiez();
  }]]);
}
