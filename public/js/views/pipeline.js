// Pipeline sprzedazowy - kanban po kamieniach karty ratingu + szczegoly tematu
// Mechanika: awans kamienia = decyzja handlowca; delty w obrebie kamienia = wyniki dzialan;
// korekta reczna oznaczana w audycie; zamkniecie wymaga kodu przyczyny (win/loss).
import { GET, POST, PUT, slowniki, karty } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badgeStatus, dataPl, mln, pct, pasekPrawd } from '../ui.js';
import { formularzDzialania, listaDzialan } from './dzialania.js';

export async function widokPipeline(kontener) {
  const [tematy, listaKart] = await Promise.all([GET('/tematy'), karty()]);
  const otwarte = tematy.filter(t => t.status === 'otwarty');
  const zamkniete = tematy.filter(t => t.status !== 'otwarty');

  const wartoscW = otwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0) * t.prawdopodobienstwo / 100, 0);

  // Kanban per karta ratingu (docelowo rozne procesy: klient powracajacy, deweloper, farmacja)
  const kartyZTematami = listaKart.filter(k => otwarte.some(t => t.karta_id === k.id));
  const kartyDoPokazania = kartyZTematami.length ? kartyZTematami : listaKart.slice(0, 1);

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Pipeline sprzedażowy'),
        el('p', { class: 'podtytul' },
          `${otwarte.length} tematów otwartych · wartość ważona ${mln(wartoscW)} PLN · oś: % szansy na WYGRANĄ`)),
      el('div', { class: 'info-box', style: 'margin:0' }, 'Nowe tematy powstają przez decyzję BID Komitetu Ofertowego')),

    ...kartyDoPokazania.map(karta => el('div', {},
      kartyDoPokazania.length > 1 ? el('h2', {}, karta.nazwa) : '',
      el('div', { class: 'kanban' },
        ...(karta.kamienie || []).map(km => {
          const wKolumnie = otwarte.filter(t => t.kamien_id === km.id);
          const suma = wKolumnie.reduce((s, t) => s + (t.wartosc_kontraktu || 0), 0);
          return el('div', { class: 'kanban-kolumna' },
            el('div', { class: 'kanban-naglowek' },
              el('span', {}, km.nazwa),
              el('span', { title: 'liczba tematów / suma wartości' }, `${wKolumnie.length} · ${suma ? mln(suma) : '0'}`)),
            ...wKolumnie.map(t => el('div', {
              class: 'kanban-karta', onclick: () => location.hash = '#/tematy/' + t.id
            },
              el('div', { class: 'kk-id' }, t.identyfikator),
              el('div', { class: 'kk-info' },
                el('span', {}, t.klient_nazwa || '—'),
                el('span', {}, mln(t.wartosc_kontraktu))),
              el('div', { class: 'kk-info' },
                el('span', {}, pct(t.prawdopodobienstwo), t.korekta_reczna ? ' ✎' : ''),
                el('span', {}, t.dzialania_otwarte ? `${t.dzialania_otwarte} dział.` : '')),
              el('div', { style: 'margin-top:6px' }, pasekPrawd(t.prawdopodobienstwo)))));
        })))),

    zamkniete.length ? el('div', {},
      el('h2', {}, 'Tematy zamknięte / wstrzymane'),
      tabela([
        { naglowek: 'Identyfikator', render: w => w.identyfikator },
        { naglowek: 'Klient', render: w => w.klient_nazwa || '—' },
        { naglowek: 'Wartość', klasa: 'liczba', render: w => mln(w.wartosc_kontraktu) },
        { naglowek: 'Status', render: w => badgeStatus(w.status) },
        { naglowek: 'Przyczyna', render: w => w.przyczyna_zamkniecia || '—' },
      ], zamkniete, w => location.hash = '#/tematy/' + w.id)) : '',
  );
}

export async function widokTemat(kontener, id) {
  const [t, sl] = await Promise.all([GET('/tematy/' + id), slowniki()]);
  const odswiez = () => widokTemat((kontener.innerHTML = '', kontener), id);
  const otwarty = t.status === 'otwarty';

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, t.identyfikator, ' ', badgeStatus(t.status)),
        el('p', { class: 'podtytul' },
          `${t.klient_nazwa || ''} · ${t.karta_nazwa} · kamień: ${t.kamien_nazwa} · ` ,
          `prawdopodobieństwo wygranej: ${t.prawdopodobienstwo}%`,
          t.korekta_reczna ? ' (korekta ręczna ✎)' : '')),
      el('div', { style: 'display:flex; gap:8px; flex-wrap:wrap;' },
        el('button', { class: 'btn', onclick: () => formularzTematu(t, sl, odswiez) }, 'Edytuj dane'),
        otwarty ? el('button', { class: 'btn btn-czerwony', onclick: () => zamknijTemat(t, sl, odswiez) }, 'Zamknij temat') :
          el('button', { class: 'btn', onclick: async () => { await POST(`/tematy/${id}/otworz`); toast('Temat otwarty ponownie'); odswiez(); } }, 'Otwórz ponownie'))),

    t.czy_bierzemy === 'odpuszczamy' ? el('div', { class: 'ostrzezenie' }, `Temat oznaczony „odpuszczamy”: ${t.powod_odpuszczenia || ''}`) : '',

    // Kamienie karty ratingu
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Kamienie milowe — ', t.karta_nazwa),
      el('div', { class: 'info-box' }, 'Awans do kolejnego kamienia to zawsze Twoja decyzja (nie automat). Osiągnięcie kamienia przelicza prawdopodobieństwo na wartość startową. Cofnięcie wymaga powodu.'),
      el('div', { class: 'stepper' },
        ...t.kamienie.map(km => {
          const aktualny = km.id === t.kamien_id;
          const zaliczony = km.kolejnosc < t.kamien_kolejnosc;
          return el('div', {
            class: 'step' + (zaliczony ? ' zaliczony' : '') + (aktualny ? ' aktualny' : ''),
            title: `start ${km.prawd_start}% (zakres ${km.prawd_min}-${km.prawd_max}%)`,
            onclick: () => {
              if (aktualny || !otwarty) return;
              const cofniecie = km.kolejnosc < t.kamien_kolejnosc;
              if (cofniecie) {
                const powodInput = el('input', { placeholder: 'np. klient wstrzymał projekt' });
                modal('Cofnięcie kamienia — wymagany powód',
                  el('div', { class: 'pole' }, el('label', {}, `Powód cofnięcia do „${km.nazwa}”`), powodInput),
                  [['Cofnij kamień', 'btn-czerwony', async () => {
                    if (!powodInput.value) { toast('Podaj powód cofnięcia', true); return false; }
                    await POST(`/tematy/${id}/kamien`, { kamien_id: km.id, powod: powodInput.value });
                    toast('Kamień cofnięty'); odswiez();
                  }]]);
              } else {
                modal(`Awans do kamienia „${km.nazwa}”`,
                  el('p', {}, `Prawdopodobieństwo zostanie przeliczone na ${km.prawd_start}%. Potwierdzasz, że temat osiągnął ten kamień na podstawie faktów?`),
                  [['Potwierdzam awans', 'btn-glowny', async () => {
                    await POST(`/tematy/${id}/kamien`, { kamien_id: km.id });
                    toast(`Kamień: ${km.nazwa} (${km.prawd_start}%)`); odswiez();
                  }]]);
              }
            }
          }, `${km.kolejnosc}. ${km.nazwa} (${km.prawd_start}%)`);
        })),
      otwarty ? el('div', { class: 'form-siatka', style: 'margin-top:10px; max-width:420px;' },
        el('div', { class: 'pole' },
          el('label', {}, `Korekta ręczna % (zakres kamienia: ${t.prawd_min}–${t.prawd_max}%)`),
          el('div', { style: 'display:flex; gap:8px;' },
            el('input', { type: 'number', min: t.prawd_min, max: t.prawd_max, value: t.prawdopodobienstwo, id: 'korekta-prawd' }),
            el('button', {
              class: 'btn btn-maly', onclick: async () => {
                const w = Number(document.getElementById('korekta-prawd').value);
                await POST(`/tematy/${id}/prawdopodobienstwo`, { wartosc: w });
                toast('Prawdopodobieństwo skorygowane (oznaczone jako ręczne)'); odswiez();
              }
            }, 'Zapisz')),
          el('div', { class: 'pomoc' }, 'Korekta jest oznaczana w audycie. Zmiany automatyczne wynikają z wyników działań.'))) : null),

    // Dane tematu
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Dane tematu'),
      el('div', { class: 'szczegoly' },
        poz('Wartość kontraktu WPIP', mln(t.wartosc_kontraktu) + ' PLN'),
        poz('Marża planowana', pct(t.marza_pct)),
        poz('Marża (mln)', t.wartosc_kontraktu && t.marza_pct ? mln(t.wartosc_kontraktu * t.marza_pct / 100) : '—'),
        poz('Model realizacji', t.model_realizacji || '—'),
        poz('Co budujemy', t.co_budujemy || '—'),
        poz('Handlowiec', t.handlowiec || '—'),
        poz('Osoba kontaktowa', t.osoba_nazwa || '—'),
        poz('Termin złożenia oferty', dataPl(t.termin_oferty)),
        poz('Termin rozpoczęcia realizacji', dataPl(t.termin_realizacji)),
        poz('Czas trwania', t.czas_trwania_mies ? t.czas_trwania_mies + ' mies.' : '—'),
        poz('Źródło', t.zrodlo || '—'),
        poz('Data startu', dataPl(t.data_startu))),
      t.notatki ? el('div', { style: 'margin-top:10px' }, poz('Notatki', t.notatki)) : null),

    // Dzialania outcome-driven
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Działania (outcome-driven)'),
        otwarty ? el('button', {
          class: 'btn btn-maly btn-glowny',
          onclick: () => formularzDzialania({ temat_id: t.id, klient_id: t.klient_id, kamien_id: t.kamien_id }, odswiez)
        }, '+ Działanie') : null),
      el('div', { class: 'info-box' }, 'Cel działania = rezultat do uzyskania OD KLIENTA (np. „uzyskać potwierdzenie odbioru oferty przez decydenta”), nie czynność handlowca. Wynik działania automatycznie porusza % w obrębie kamienia.'),
      listaDzialan(t.dzialania, odswiez)),

    // Historia zmian (audyt)
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
    pole({
      name: 'czy_bierzemy', label: 'Czy bierzemy temat', typ: 'select', wartosc: t.czy_bierzemy, pusta: false,
      opcje: ['ofertujemy', 'obserwujemy', 'odpuszczamy'], pomoc: 'Bramka pre-kwalifikacyjna — świadoma decyzja, nie scoring'
    }),
    pole({ name: 'powod_odpuszczenia', label: 'Powód odpuszczenia (jeśli odpuszczamy)', typ: 'select', wartosc: t.powod_odpuszczenia, opcje: (sl.powod_odpuszczenia || []).map(p => p.wartosc) }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: t.notatki, szerokie: true }));

  modal('Edytuj temat ' + t.identyfikator, form, [
    ['Zapisz', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (d.czy_bierzemy === 'odpuszczamy' && !d.powod_odpuszczenia) {
        toast('Powód odpuszczenia jest obowiązkowy', true); return false;
      }
      await PUT('/tematy/' + t.id, d);
      toast('Temat zapisany'); poZapisie?.();
    }],
  ]);
}

function zamknijTemat(t, sl, poZapisie) {
  const wygrane = (sl.przyczyna_wygranej || []).map(p => p.wartosc);
  const przegrane = (sl.przyczyna_przegranej || []).map(p => p.wartosc);

  const przyczynaPole = el('div', { class: 'form-siatka' });
  function rysujPrzyczyny(status) {
    przyczynaPole.innerHTML = '';
    if (status === 'wygrany' || status === 'przegrany') {
      przyczynaPole.append(pole({
        name: 'przyczyna', label: 'Kod przyczyny (obowiązkowy — pętla lessons learned)',
        typ: 'select', opcje: status === 'wygrany' ? wygrane : przegrane, wymagane: true
      }));
    }
  }

  const form = el('div', {},
    el('div', { class: 'form-siatka' },
      pole({
        name: 'status', label: 'Status zamknięcia', typ: 'select', pusta: false,
        opcje: [['wygrany', 'Wygrany — umowa podpisana'], ['przegrany', 'Przegrany'], ['odrzucony', 'Odrzucony (my rezygnujemy)'], ['wstrzymany', 'Wstrzymany (klient zamroził)']],
        onchange: e => rysujPrzyczyny(e.target.value),
      })),
    el('div', { style: 'height:8px' }),
    przyczynaPole,
    el('div', { class: 'form-siatka', style: 'margin-top:8px' },
      pole({ name: 'opis', label: 'Kontekst / czego się uczymy', typ: 'textarea', szerokie: true })));
  rysujPrzyczyny('wygrany');

  modal('Zamknięcie tematu ' + t.identyfikator, form, [
    ['Zamknij temat', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      await POST(`/tematy/${t.id}/zamknij`, d);
      toast('Temat zamknięty: ' + d.status); poZapisie?.();
    }],
  ]);
}
