// Dzialania outcome-driven - wspoldzielone przez leady, tematy, klientow
import { GET, POST, PUT, slowniki } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badgeStatus, dataPl } from '../ui.js';

export async function widokDzialania(kontener) {
  const sl = await slowniki();
  let zakres = 'tydzien';
  const listaBox = el('div');

  async function rysuj() {
    const dane = await GET('/dzialania' + (zakres === 'tydzien' ? '?zakres=tydzien' : ''));
    listaBox.innerHTML = '';
    listaBox.append(tabela([
      { naglowek: 'Termin', render: w => dataPl(w.termin) },
      { naglowek: 'Cel (rezultat od klienta)', render: w => w.cel },
      { naglowek: 'Typ', render: w => w.typ || '—' },
      { naglowek: 'Dotyczy', render: w => w.temat_identyfikator || w.lead_nazwa || w.klient_nazwa || '—' },
      { naglowek: 'Status', render: w => badgeStatus(w.status) },
      { naglowek: 'Wynik', render: w => w.wynik ? `${w.wynik}${w.delta_zastosowana ? ` (${w.delta_zastosowana > 0 ? '+' : ''}${w.delta_zastosowana}%)` : ''}` : '—' },
      {
        naglowek: '', render: w => w.status === 'planowane'
          ? el('button', { class: 'btn btn-maly', onclick: (e) => { e.stopPropagation(); zapiszWynik(w, sl, rysuj); } }, 'Wynik')
          : ''
      },
    ], dane, w => {
      if (w.temat_id) location.hash = '#/tematy/' + w.temat_id;
      else if (w.lead_id) location.hash = '#/leady/' + w.lead_id;
      else if (w.klient_id) location.hash = '#/klienci/' + w.klient_id;
    }));
  }
  await rysuj();

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Działania'),
        el('p', { class: 'podtytul' }, 'Bieżący tydzień + pełna historia — budujemy track record, nie 30-dniowe okno')),
      el('button', { class: 'btn btn-glowny', onclick: () => formularzDzialania({}, rysuj) }, '+ Działanie')),
    el('div', { class: 'filtry' },
      el('select', {
        onchange: e => { zakres = e.target.value; rysuj(); }
      },
        el('option', { value: 'tydzien' }, 'Najbliższy tydzień (planowane)'),
        el('option', { value: 'wszystkie' }, 'Pełna historia'))),
    listaBox);
}

export function listaDzialan(dzialania, poZmianie) {
  const box = el('div');
  slowniki().then(sl => {
    box.append(tabela([
      { naglowek: 'Termin', render: w => dataPl(w.termin) },
      { naglowek: 'Cel (rezultat od klienta)', render: w => w.cel },
      { naglowek: 'Typ', render: w => w.typ || '—' },
      { naglowek: 'Status', render: w => badgeStatus(w.status) },
      { naglowek: 'Wynik', render: w => w.wynik ? `${w.wynik}${w.delta_zastosowana ? ` (${w.delta_zastosowana > 0 ? '+' : ''}${w.delta_zastosowana}%)` : ''}` : '—' },
      {
        naglowek: '', render: w => w.status === 'planowane'
          ? el('button', { class: 'btn btn-maly', onclick: (e) => { e.stopPropagation(); zapiszWynik(w, sl, poZmianie); } }, 'Wynik')
          : ''
      },
    ], dzialania));
  });
  return box;
}

export async function formularzDzialania(kontekst, poZapisie) {
  const sl = await slowniki();
  const typy = (sl.typ_dzialania || []).map(t => t.wartosc);

  const form = el('div', { class: 'form-siatka' },
    pole({
      name: 'cel', label: 'Cel — oczekiwany rezultat od klienta', wymagane: true, szerokie: true,
      placeholder: 'np. uzyskać informację o dacie decyzji zarządu klienta',
      pomoc: 'Formułuj jako rezultat od klienta, nie czynność („wysłać maila” ✗ / „uzyskać potwierdzenie odbioru oferty” ✓)'
    }),
    pole({ name: 'typ', label: 'Typ działania', typ: 'select', opcje: typy }),
    pole({ name: 'termin', label: 'Termin', typ: 'date' }),
    pole({ name: 'opis', label: 'Opis / plan', typ: 'textarea', szerokie: true }));

  modal('Nowe działanie', form, [
    ['Zapisz', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (!d.cel) { toast('Cel działania jest wymagany', true); return false; }
      await POST('/dzialania', { ...d, ...kontekst });
      toast('Działanie zaplanowane'); poZapisie?.();
    }],
  ]);
}

function zapiszWynik(dzialanie, sl, poZapisie) {
  const wyniki = sl.wynik_dzialania || [];
  const form = el('div', {},
    el('p', {}, el('b', {}, 'Cel: '), dzialanie.cel),
    el('div', { class: 'form-siatka' },
      pole({
        name: 'wynik', label: 'Wynik działania', typ: 'select', wymagane: true,
        opcje: wyniki.map(w => [w.wartosc, `${w.wartosc} (delta ${w.delta > 0 ? '+' : ''}${w.delta}%)`]),
        pomoc: 'Wynik mapuje się na automatyczną zmianę prawdopodobieństwa w obrębie kamienia (dla tematów w pipeline)'
      })));

  modal('Wynik działania', form, [
    ['Zapisz wynik', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (!d.wynik) { toast('Wybierz wynik', true); return false; }
      const r = await POST(`/dzialania/${dzialanie.id}/wynik`, d);
      toast(r.delta_zastosowana
        ? `Wynik zapisany — prawdopodobieństwo ${r.delta_zastosowana > 0 ? '+' : ''}${r.delta_zastosowana}%`
        : 'Wynik zapisany');
      poZapisie?.();
    }],
  ]);
}
