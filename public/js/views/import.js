// Import leadow z bazy sygnalow (KI) do wskazanej GRUPY, ze scoringiem wg wersji grupy
// Krok 1: plik -> Krok 2: zakladka + grupa -> Krok 3: podglad z auto-scoringiem i wybor wierszy
import { GET, POST } from '../api.js';
import { el, modal, pole, zbierzForm, toast, badgePriorytet, badge, mln } from '../ui.js';

let stan = null; // { base64, plik, zakladki }

export async function widokImport(kontener) {
  kontener.append(
    el('h1', {}, 'Import leadów'),
    el('p', { class: 'podtytul' },
      'Import do wskazanej grupy — scoring naliczy się według wersji przypisanej do grupy. Nakłady baz nie duplikują leadów: istniejący lead dostaje wystąpienie i świeże dane.'),
    krokPlik(kontener));
}

function krokPlik(kontener) {
  const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.ods', style: 'max-width:420px' });
  input.addEventListener('change', async () => {
    const plik = input.files[0];
    if (!plik) return;
    try {
      const base64 = await doBase64(plik);
      const wynik = await POST('/import/parse', { base64, nazwa_pliku: plik.name });
      stan = { base64, plik: plik.name, zakladki: wynik.zakladki };
      kontener.innerHTML = '';
      kontener.append(
        el('h1', {}, 'Import leadów'),
        el('p', { class: 'podtytul' }, `Plik: ${plik.name} — wybierz zakładkę i grupę docelową`),
        await krokZakladkaIGrupa(kontener));
    } catch (err) { toast(err.message, true); }
  });
  return el('div', { class: 'karta-box' },
    el('h2', { style: 'margin-top:0' }, 'Krok 1 — wybierz plik'),
    el('div', { class: 'info-box' },
      'Obsługiwane formaty: surowy eksport KI (Id, Nazwa, Podsektor, Województwo, Etap, Koszt…) oraz arkusze TOP po researchu (SCORE, Priorytet, Klasyfikacja, Branża, Status researchu). Klasyfikacja i status researchu z arkusza TOP mają pierwszeństwo nad heurystyką.'),
    input);
}

async function krokZakladkaIGrupa(kontener) {
  const [grupy, { wersje }] = await Promise.all([GET('/grupy'), GET('/wersje')]);

  // Wybor grupy: istniejaca lub nowa
  const grupaSelect = el('select', {},
    el('option', { value: 'nowa' }, '➕ Nowa grupa…'),
    ...grupy.map(g => el('option', { value: g.id }, `${g.nazwa} (${g.liczba_leadow} leadów, ${g.wersja_nazwa || 'brak wersji'})`)));
  if (grupy.length) grupaSelect.value = String(grupy[0].id);
  const nowaNazwa = el('input', { placeholder: 'np. v6 — region północny', value: stan.plik.replace(/\.(xlsx|xls|csv|ods)$/i, '') });
  const nowaWersja = el('select', {}, ...wersje.map(w => el('option', { value: w.id }, `${w.nazwa} (${w.status})`)));
  const nowaBox = el('div', { class: 'form-siatka', style: grupy.length ? 'display:none' : '' },
    el('div', { class: 'pole' }, el('label', {}, 'Nazwa nowej grupy'), nowaNazwa),
    el('div', { class: 'pole' }, el('label', {}, 'Wersja scoringu dla grupy'), nowaWersja));
  grupaSelect.addEventListener('change', () => {
    nowaBox.style.display = grupaSelect.value === 'nowa' ? '' : 'none';
  });
  if (!grupy.length) grupaSelect.value = 'nowa';

  async function ustalGrupe() {
    if (grupaSelect.value !== 'nowa') {
      const g = grupy.find(x => String(x.id) === grupaSelect.value);
      if (!g.wersja_id) throw new Error('Wybrana grupa nie ma wersji scoringu — uzupełnij w zakładce Scoring leadów');
      return { grupa_id: g.id, wersja_id: g.wersja_id, nazwa: g.nazwa };
    }
    if (!nowaNazwa.value) throw new Error('Podaj nazwę nowej grupy');
    const r = await POST('/grupy', { nazwa: nowaNazwa.value, wersja_id: Number(nowaWersja.value), zrodlo: stan.plik });
    return { grupa_id: r.id, wersja_id: Number(nowaWersja.value), nazwa: nowaNazwa.value };
  }

  return el('div', {},
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Krok 2 — grupa docelowa'),
      el('div', { class: 'form-siatka' },
        el('div', { class: 'pole' }, el('label', {}, 'Importuj do grupy'), grupaSelect)),
      nowaBox),
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Zakładka do importu'),
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Zakładka'), el('th', { class: 'liczba' }, 'Wierszy'), el('th', {}, 'Rozpoznane kolumny'), el('th', {}))),
        el('tbody', {}, ...stan.zakladki.map(z => {
          const kluczowe = z.naglowki.filter(n => ['Id', 'Nazwa', 'Inwestor', 'Podsektor', 'Etap', 'SCORE', 'Priorytet', 'Klasyfikacja', 'Branża', 'Status researchu', 'Koszt (mln)'].includes(n));
          const importowalna = z.naglowki.includes('Nazwa') || z.naglowki.includes('Inwestor');
          return el('tr', {},
            el('td', {}, el('b', {}, z.nazwa)),
            el('td', { class: 'liczba' }, String(z.wierszy)),
            el('td', {}, kluczowe.length ? kluczowe.join(', ') : el('span', { style: 'color:var(--tekst-2)' }, 'brak kolumn importu')),
            el('td', {}, importowalna ? el('button', {
              class: 'btn btn-maly btn-glowny', onclick: async (e) => {
                e.target.disabled = true;
                try {
                  const grupa = await ustalGrupe();
                  const wynik = await POST('/import/podglad', { base64: stan.base64, zakladka: z.nazwa, wersja_id: grupa.wersja_id });
                  kontener.innerHTML = '';
                  kontener.append(
                    el('h1', {}, 'Import leadów'),
                    el('p', { class: 'podtytul' }, `${stan.plik} → ${z.nazwa} → grupa „${grupa.nazwa}" — ${wynik.propozycje.length} pozycji`),
                    krokPodglad(kontener, wynik, grupa));
                } catch (err) { toast(err.message, true); e.target.disabled = false; }
              }
            }, 'Podgląd') : ''));
        })))));
}

function krokPodglad(kontener, wynik, grupa) {
  const zaznaczone = new Map();
  for (const p of wynik.propozycje) {
    // domyslnie: nowe, niezdyskwalifikowane; wystapienia zaznaczone (aktualizacja danych jest pozadana)
    zaznaczone.set(p, p.wystapienie ? true : !p.dyskwalifikacja);
  }

  const podsumowanie = el('div', { class: 'info-box' });
  function odswiezPodsumowanie() {
    const wybrane = [...zaznaczone.entries()].filter(([, v]) => v).map(([p]) => p);
    const nowe = wybrane.filter(p => !p.wystapienie);
    const prio = nowe.reduce((acc, p) => { acc[p.priorytet] = (acc[p.priorytet] || 0) + 1; return acc; }, {});
    podsumowanie.textContent = `Nowe leady: ${nowe.length} (` +
      ['A', 'B', 'C', 'D', 'X'].filter(k => prio[k]).map(k => `${k}: ${prio[k]}`).join(' · ') +
      `) · wystąpienia (aktualizacja danych): ${wybrane.filter(p => p.wystapienie).length}`;
  }
  odswiezPodsumowanie();

  const handlowiecInput = el('input', { placeholder: 'np. Krystian', style: 'max-width:200px', value: 'Krystian' });

  const tbody = el('tbody', {}, ...wynik.propozycje.map(p => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = zaznaczone.get(p);
    cb.addEventListener('change', () => { zaznaczone.set(p, cb.checked); odswiezPodsumowanie(); });
    const opisScoringu = Object.entries(p.wybory).map(([k, v]) => `${k}: ${v || '—'}`).join('\n');
    return el('tr', { style: p.wystapienie ? 'opacity:.6' : (p.dyskwalifikacja ? 'background:var(--czerwony-tlo)' : '') },
      el('td', { class: 'wysrodkuj' }, cb),
      el('td', { class: 'wysrodkuj' }, badgePriorytet(p.priorytet)),
      el('td', { class: 'liczba', title: opisScoringu, style: 'cursor:help; text-decoration:underline dotted' }, String(p.score_total)),
      el('td', {},
        el('b', {}, p.nazwa_inwestycji),
        el('div', { style: 'font-size:12px; color:var(--tekst-2)' }, p.klient_nazwa || p.inwestor || '—')),
      el('td', {}, [p.miasto, p.wojewodztwo].filter(Boolean).join(', ') || '—'),
      el('td', {}, p.etap || '—'),
      el('td', { class: 'liczba' }, p.koszt ? mln(Number(p.koszt)) : '—'),
      el('td', {},
        p.wystapienie ? badge('wystąpienie — lead istnieje', 'nieb') : '',
        p.dyskwalifikacja ? badge('⛔ ' + (p.dyskwalifikacja_powod || 'X'), 'czerwony') : '',
        !p.wystapienie && !p.dyskwalifikacja && p.do_weryfikacji ? badge('C/E2 do weryfikacji', 'zolty') : '',
        p.score_zewnetrzny ? badge(`arkusz: ${p.score_zewnetrzny}`, 'szary') : '',
        p.status_researchu_arkusz && p.status_researchu_arkusz !== '0' ? badge('research: ' + p.status_researchu_arkusz,
          p.status_researchu_arkusz === 'ZIELONE' ? 'zielony' : p.status_researchu_arkusz === 'CZERWONE' ? 'czerwony' : 'zolty') : ''));
  }));

  const masowe = (fn) => () => {
    for (const [p] of zaznaczone) zaznaczone.set(p, fn(p));
    tbody.querySelectorAll('tr').forEach((tr, i) => {
      tr.querySelector('input[type=checkbox]').checked = zaznaczone.get(wynik.propozycje[i]);
    });
    odswiezPodsumowanie();
  };

  return el('div', {},
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Krok 3 — podgląd i wybór'),
      podsumowanie,
      el('div', { class: 'filtry' },
        el('span', {}, 'Zaznacz:'),
        el('button', { class: 'btn btn-maly', onclick: masowe(() => true) }, 'wszystkie'),
        el('button', { class: 'btn btn-maly', onclick: masowe(p => p.wystapienie || !p.dyskwalifikacja) }, 'bez dyskwalifikacji'),
        el('button', { class: 'btn btn-maly', onclick: masowe(p => p.wystapienie || ['A', 'B'].includes(p.priorytet)) }, 'tylko A i B'),
        el('button', { class: 'btn btn-maly', onclick: masowe(() => false) }, 'żadne'),
        el('span', { style: 'margin-left:16px' }, 'Handlowiec:'), handlowiecInput,
        el('button', {
          class: 'btn btn-glowny', style: 'margin-left:auto', onclick: async (e) => {
            const wybrane = [...zaznaczone.entries()].filter(([, v]) => v).map(([p]) => p);
            if (!wybrane.length) { toast('Nie zaznaczono żadnych pozycji', true); return; }
            e.target.disabled = true;
            try {
              const stat = await POST('/import/wykonaj', { wiersze: wybrane, grupa_id: grupa.grupa_id, handlowiec: handlowiecInput.value || null });
              kontener.innerHTML = '';
              kontener.append(
                el('h1', {}, 'Import zakończony'),
                el('div', { class: 'karta-box' },
                  el('div', { class: 'kafle' },
                    kafelStat('Nowe leady', stat.leady_nowe),
                    kafelStat('Nowi klienci', stat.klienci_nowi),
                    kafelStat('Wystąpienia (nakład baz)', stat.wystapienia),
                    kafelStat('Aktualizacje danych', stat.aktualizacje_danych),
                    kafelStat('Zmiany priorytetu', stat.zmiany_priorytetu),
                    kafelStat('Dyskwalifikacje (X)', stat.dyskwalifikacje)),
                  el('div', { style: 'display:flex; gap:10px; margin-top:10px' },
                    el('a', { class: 'btn btn-glowny', href: '#/leady?grupa=' + grupa.grupa_id }, 'Przejdź do grupy'),
                    el('button', { class: 'btn', onclick: () => { stan = null; location.reload(); } }, 'Importuj kolejny plik'))));
              toast(`Zaimportowano ${stat.leady_nowe} leadów do grupy „${grupa.nazwa}"`);
            } catch (err) { toast(err.message, true); e.target.disabled = false; }
          }
        }, 'Importuj zaznaczone'))),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}), el('th', {}, 'Prio'), el('th', { class: 'liczba' }, 'Scoring'),
        el('th', {}, 'Inwestycja / klient'), el('th', {}, 'Lokalizacja'), el('th', {}, 'Etap'),
        el('th', { class: 'liczba' }, 'Koszt'), el('th', {}, 'Uwagi'))),
      tbody),
    el('p', { class: 'podtytul', style: 'margin-top:10px' },
      'Najedź na scoring, aby zobaczyć wybory komponentów. „Wystąpienie" = inwestycja już ma leada — import dopisze wystąpienie w tej grupie i zaktualizuje etap/koszt (ze śladem w historii leada).'));
}

function kafelStat(etykieta, wartosc) {
  return el('div', { class: 'kafel' },
    el('div', { class: 'etykieta' }, etykieta),
    el('div', { class: 'wartosc' }, String(wartosc)));
}

function doBase64(plik) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(plik);
  });
}
