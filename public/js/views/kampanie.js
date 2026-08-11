// KAMPANIE: testowanie hipotez segmentowych (buyer person) przez konkretne
// akcje marketingowo-sprzedazowe. Kampania = pelny obiekt: hipoteza, segment,
// zrodlo, okres, cele ilosciowe; lejek konwersji z przypisanych leadow
// prowadzi do werdyktu: hipoteza potwierdzona / obalona.
import { GET, POST, PUT, DEL } from '../api.js';
import { el, tabela, badge, modal, pole, zbierzForm, toast, dataPl } from '../ui.js';
import { ikona } from '../ikony.js';

const STATUS_BADGE = { trwa: 'nieb', potwierdzona: 'zielony', obalona: 'czerwony' };

function miniLejek(l) {
  const kroki = [['L', l.leady], ['I', l.interesujace], ['T', l.tematy], ['K', l.komitety], ['W', l.wygrane]];
  return el('div', { style: 'display:flex; gap:2px; align-items:center; font-size:12px', title: 'leady → interesujące → tematy → komitety → wygrane' },
    ...kroki.flatMap(([lit, n], i) => [
      i ? el('span', { style: 'color:var(--tekst-2)' }, '›') : '',
      el('span', { style: 'background:var(--szary-tlo); border-radius:4px; padding:1px 6px' },
        el('span', { style: 'color:var(--tekst-2)' }, lit + ' '), el('b', {}, n ?? 0)),
    ]));
}

function formKampanii(k = {}) {
  return el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa kampanii', wartosc: k.nazwa, wymagane: true, szerokie: true }),
    pole({ name: 'hipoteza', label: 'Hipoteza do przetestowania', typ: 'textarea', wartosc: k.hipoteza, szerokie: true, wymagane: true,
      pomoc: 'Np. "Rodzinne firmy produkcyjne 20–50 mln z Wielkopolski reagują na case study rozbudowy — min. 10% umówionych spotkań"' }),
    pole({ name: 'segment', label: 'Segment / buyer persona', wartosc: k.segment, pomoc: 'np. produkcja rodzinna 20 mln, deweloper magazynowy' }),
    pole({ name: 'zrodlo', label: 'Źródło / kanał', wartosc: k.zrodlo, pomoc: 'np. LinkedIn, targi, cold mailing, baza KI' }),
    pole({ name: 'data_od', label: 'Start', typ: 'date', wartosc: k.data_od }),
    pole({ name: 'data_do', label: 'Koniec', typ: 'date', wartosc: k.data_do }),
    pole({ name: 'cel_leadow', label: 'Cel: leady', typ: 'number', min: 0, wartosc: k.cel_leadow }),
    pole({ name: 'cel_tematow', label: 'Cel: tematy', typ: 'number', min: 0, wartosc: k.cel_tematow }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: k.notatki, szerokie: true }));
}

function werdykt(k, status, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'werdykt_uzasadnienie', label: 'Uzasadnienie werdyktu (co pokazał lejek?)', typ: 'textarea',
      wartosc: k.werdykt_uzasadnienie, szerokie: true, wymagane: true }));
  modal(status === 'potwierdzona' ? 'Hipoteza potwierdzona' : 'Hipoteza obalona', form,
    [['Zapisz werdykt', status === 'potwierdzona' ? 'btn-glowny' : 'btn-czerwony', async () => {
      const d = zbierzForm(form);
      if (!d.werdykt_uzasadnienie) { toast('Werdykt wymaga uzasadnienia', true); return; }
      await PUT('/kampanie/' + k.id, { status, werdykt_uzasadnienie: d.werdykt_uzasadnienie });
      toast('Werdykt zapisany'); odswiez();
    }]]);
}

async function przypiszLeady(k, odswiez) {
  const leady = (await GET('/leady')).filter(l => l.status === 'aktywny' && !l.kampania_id);
  if (!leady.length) { toast('Brak aktywnych leadów bez kampanii'); return; }
  const zaznaczone = new Set();
  const lista = el('div', { style: 'max-height:340px; overflow:auto; display:flex; flex-direction:column; gap:4px' },
    ...leady.map(l => el('label', { style: 'display:flex; gap:8px; align-items:center; font-size:13px; cursor:pointer' },
      el('input', { type: 'checkbox', onchange: e => e.target.checked ? zaznaczone.add(l.id) : zaznaczone.delete(l.id) }),
      el('span', {}, el('b', {}, l.nazwa), l.zrodlo ? el('span', { style: 'color:var(--tekst-2)' }, ` · ${l.zrodlo}`) : ''))));
  modal(`Przypisz leady do „${k.nazwa}"`, el('div', {},
    el('p', { style: 'margin-top:0; color:var(--tekst-2); font-size:13px' }, 'Aktywne leady bez kampanii (np. świeżo zaimportowana partia):'),
    lista),
    [['Przypisz zaznaczone', 'btn-glowny', async () => {
      if (!zaznaczone.size) { toast('Nie zaznaczono leadów', true); return; }
      const r = await POST(`/kampanie/${k.id}/przypisz`, { lead_ids: [...zaznaczone] });
      toast(`Przypisano ${r.przypisano} leadów`); odswiez();
    }]]);
}

export async function widokKampanie(kontener) {
  const kampanie = await GET('/kampanie');
  const odswiez = () => { kontener.innerHTML = ''; widokKampanie(kontener); };

  const celBadge = (jest, cel) => cel
    ? badge(`${jest ?? 0} / ${cel}`, (jest ?? 0) >= cel ? 'zielony' : 'szary')
    : el('span', { style: 'color:var(--tekst-2)' }, jest ?? 0);

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Segmenty i kampanie'),
        el('p', { class: 'podtytul' }, 'Testowanie hipotez segmentowych: kampania → lejek przypisanych leadów → werdykt')),
      el('button', { class: 'btn btn-glowny', onclick: () => {
        const form = formKampanii();
        modal('Nowa kampania', form, [['Utwórz', 'btn-glowny', async () => {
          const d = zbierzForm(form);
          if (!d.nazwa || !d.hipoteza) { toast('Nazwa i hipoteza są wymagane', true); return; }
          await POST('/kampanie', d); toast('Kampania utworzona'); odswiez();
        }]]);
      } }, ikona('plus', 14), 'Nowa kampania')),
    el('div', { class: 'info-box' },
      'Każda kampania testuje jedną hipotezę o segmencie. Leady przypisujesz przy imporcie partii lub ręcznie; ',
      'lejek L › I › T › K › W (leady › interesujące › tematy › komitety › wygrane) liczy się sam. ',
      'Zamknij kampanię werdyktem — potwierdzone hipotezy skalujesz, obalone przestajesz finansować.'),
    kampanie.length ? tabela([
      { naglowek: 'Kampania', render: k => el('div', {},
        el('b', {}, k.nazwa),
        el('div', { style: 'font-size:12px; color:var(--tekst-2); max-width:320px' }, (k.hipoteza || '').slice(0, 110))) },
      { naglowek: 'Segment', render: k => k.segment || '—' },
      { naglowek: 'Źródło', render: k => k.zrodlo || '—' },
      { naglowek: 'Okres', render: k => `${k.data_od ? dataPl(k.data_od) : '…'} – ${k.data_do ? dataPl(k.data_do) : '…'}` },
      { naglowek: 'Lejek', render: k => miniLejek(k.lejek) },
      { naglowek: 'Cel leadów', klasa: 'wysrodkuj', render: k => celBadge(k.lejek.leady, k.cel_leadow) },
      { naglowek: 'Cel tematów', klasa: 'wysrodkuj', render: k => celBadge(k.lejek.tematy, k.cel_tematow) },
      { naglowek: 'Status', klasa: 'wysrodkuj', render: k => el('span', { title: k.werdykt_uzasadnienie || '' },
        badge(k.status, STATUS_BADGE[k.status] || 'szary')) },
      { naglowek: '', render: k => el('div', { style: 'display:flex; gap:4px; flex-wrap:wrap' },
        el('button', { class: 'btn btn-maly', onclick: (e) => { e.stopPropagation(); przypiszLeady(k, odswiez); } }, 'Przypisz leady'),
        el('button', { class: 'btn btn-maly', onclick: (e) => {
          e.stopPropagation();
          const form = formKampanii(k);
          modal('Edytuj kampanię', form, [['Zapisz', 'btn-glowny', async () => {
            await PUT('/kampanie/' + k.id, zbierzForm(form)); toast('Zapisano'); odswiez();
          }]]);
        } }, 'Edytuj'),
        ...(k.status === 'trwa' ? [
          el('button', { class: 'btn btn-maly', style: 'color:var(--zielony)', onclick: (e) => { e.stopPropagation(); werdykt(k, 'potwierdzona', odswiez); } }, '✓ potwierdzona'),
          el('button', { class: 'btn btn-maly', style: 'color:var(--czerwony)', onclick: (e) => { e.stopPropagation(); werdykt(k, 'obalona', odswiez); } }, '✕ obalona'),
        ] : [])) },
    ], kampanie)
      : el('div', { class: 'karta-box puste' }, 'Brak kampanii. Utwórz pierwszą i przypisz do niej partię leadów.'));
}
