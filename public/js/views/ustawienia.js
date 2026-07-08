// Ustawienia - karty ratingu pipeline'u + slowniki (edytowalne przez biznes, bez programisty)
// Scoring leadow (wersje, wagi, progi) ma wlasna zakladke: #/scoring
import { GET, POST, PUT, DEL, karty, invalidateCache } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela } from '../ui.js';

const NAZWY_SLOWNIKOW = {
  powod_odpuszczenia: 'Powody odpuszczenia (leady / bramka / Komitet)',
  przyczyna_wygranej: 'Przyczyny wygranej (win/loss)',
  przyczyna_przegranej: 'Przyczyny przegranej (win/loss)',
  wynik_dzialania: 'Wyniki działań (z deltą % prawdopodobieństwa)',
  model_realizacji: 'Modele realizacji',
  zrodlo_leada: 'Źródła leadów',
  typ_dzialania: 'Typy działań',
  kamien_prospectingu: 'Ścieżka pozyskania tematu (kamienie prospectingu)',
  buyer_persona: 'Buyer persony (model wstępny)',
  miasto_referencyjne: 'Miasta referencyjne WPIP (komponent E3 — bliskość)',
};

export async function widokUstawienia(kontener) {
  const [listaKart, slowniki] = await Promise.all([karty(true), GET('/slowniki')]);

  kontener.append(
    el('h1', {}, 'Ustawienia'),
    el('p', { class: 'podtytul' }, 'Karty ratingu pipeline’u, słowniki i konto. Scoring leadów (wersje, wagi, progi) znajdziesz w zakładce „Scoring leadów".'),

    // Zmiana hasla
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Konto — zmiana hasła'),
      (() => {
        const form = el('div', { class: 'form-siatka', style: 'max-width:600px' },
          pole({ name: 'stare', label: 'Obecne hasło', typ: 'password' }),
          pole({ name: 'nowe', label: 'Nowe hasło (min. 8 znaków)', typ: 'password' }),
          el('div', { class: 'pole' }, el('label', {}, ' '),
            el('button', {
              class: 'btn btn-glowny', onclick: async () => {
                const d = zbierzForm(form);
                try {
                  await POST('/zmien-haslo', d);
                  toast('Hasło zmienione');
                  form.querySelectorAll('input').forEach(i => i.value = '');
                } catch (e) { toast(e.message, true); }
              }
            }, 'Zmień hasło')));
        return form;
      })()),

    // Karty ratingu (pipeline)
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Karty ratingu prawdopodobieństwa (procesy sprzedaży w pipeline)'),
      el('div', { class: 'info-box' }, 'Karta = konfigurowalna definicja procesu sprzedaży. Docelowo więcej kart: klient powracający, deweloper magazynowy, farmacja. Kliknij wartość, aby edytować.'),
      ...listaKart.map(karta =>
        el('div', { style: 'margin-bottom:16px' },
          el('h2', { style: 'font-size:14px' }, karta.nazwa, ' ', el('span', { style: 'color:var(--tekst-2); font-weight:400' }, karta.opis || '')),
          tabela([
            { naglowek: '#', klasa: 'wysrodkuj', render: k => String(k.kolejnosc) },
            { naglowek: 'Kamień milowy', render: k => edytowalne(k.nazwa, async (v) => { await PUT('/kamienie/' + k.id, { nazwa: v }); }) },
            { naglowek: 'Start %', klasa: 'liczba', render: k => edytowalne(String(k.prawd_start), async (v) => { await PUT('/kamienie/' + k.id, { prawd_start: Number(v) }); }, 'number') },
            { naglowek: 'Min %', klasa: 'liczba', render: k => edytowalne(String(k.prawd_min), async (v) => { await PUT('/kamienie/' + k.id, { prawd_min: Number(v) }); }, 'number') },
            { naglowek: 'Max %', klasa: 'liczba', render: k => edytowalne(String(k.prawd_max), async (v) => { await PUT('/kamienie/' + k.id, { prawd_max: Number(v) }); }, 'number') },
          ], karta.kamienie))),
      el('button', {
        class: 'btn', onclick: () => {
          const form = el('div', { class: 'form-siatka' },
            pole({ name: 'nazwa', label: 'Nazwa procesu sprzedaży', wymagane: true, placeholder: 'np. Klient powracający — rozbudowa' }),
            pole({ name: 'opis', label: 'Opis', szerokie: true }));
          modal('Nowa karta ratingu', form, [['Utwórz', 'btn-glowny', async () => {
            const d = zbierzForm(form);
            if (!d.nazwa) { toast('Nazwa jest wymagana', true); return false; }
            const r = await POST('/karty', d);
            const wzor = listaKart[0];
            for (const km of (wzor?.kamienie || [])) {
              await POST(`/karty/${r.id}/kamienie`, { nazwa: km.nazwa, kolejnosc: km.kolejnosc, prawd_start: km.prawd_start, prawd_min: km.prawd_min, prawd_max: km.prawd_max });
            }
            invalidateCache(); toast('Karta utworzona (kamienie skopiowane ze standardu)'); location.reload();
          }]]);
        }
      }, '+ Nowa karta ratingu')),

    // Slowniki
    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Słowniki'),
      ...Object.entries(NAZWY_SLOWNIKOW).map(([typ, nazwa]) => {
        const pozycje = slowniki[typ] || [];
        return el('div', { style: 'margin-bottom:14px' },
          el('h2', { style: 'font-size:13px; margin:8px 0 6px' }, nazwa),
          tabela([
            { naglowek: 'Wartość', render: s => s.wartosc },
            ...(typ === 'wynik_dzialania' ? [{
              naglowek: 'Delta %', klasa: 'liczba',
              render: s => edytowalne(String(s.delta ?? 0), async (v) => { await PUT('/slowniki/' + s.id, { delta: Number(v) }); invalidateCache(); }, 'number')
            }] : []),
            {
              naglowek: '', klasa: 'wysrodkuj', render: s => el('button', {
                class: 'btn btn-maly btn-czerwony', onclick: async () => {
                  await DEL('/slowniki/' + s.id); invalidateCache(); toast('Usunięto'); location.reload();
                }
              }, 'usuń')
            },
          ], pozycje),
          el('div', { style: 'margin-top:6px' },
            el('button', {
              class: 'btn btn-maly', onclick: () => {
                const form = el('div', { class: 'form-siatka' },
                  pole({ name: 'wartosc', label: 'Nowa wartość', wymagane: true }),
                  ...(typ === 'wynik_dzialania' ? [pole({ name: 'delta', label: 'Delta %', typ: 'number', wartosc: 0 })] : []));
                modal('Dodaj do słownika: ' + nazwa, form, [['Dodaj', 'btn-glowny', async () => {
                  const d = zbierzForm(form);
                  if (!d.wartosc) { toast('Wartość jest wymagana', true); return false; }
                  await POST('/slowniki', { typ, ...d });
                  invalidateCache(); toast('Dodano'); location.reload();
                }]]);
              }
            }, '+ dodaj')));
      })),
  );
}

// Klikniecie w wartosc -> inline edycja
function edytowalne(wartosc, zapisz, typ = 'text') {
  const span = el('span', { class: 'link', title: 'kliknij aby edytować' }, wartosc);
  span.addEventListener('click', () => {
    const input = el('input', { type: typ, value: wartosc, style: 'width:90px' });
    span.replaceWith(input);
    input.focus();
    let zapisano = false;
    const commit = async () => {
      if (zapisano) return; zapisano = true;
      try { await zapisz(input.value); toast('Zapisano'); location.reload(); }
      catch (e) { toast(e.message, true); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    input.addEventListener('blur', commit);
  });
  return span;
}
