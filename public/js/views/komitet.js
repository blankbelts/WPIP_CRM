// Komitet Ofertowy = kamien M5 (STANDARD) / F3 (FAST-TRACK) wewnatrz tematu.
// BID = potwierdzenie kamienia (rejestracja ZOS). NO-BID = zamkniecie z powodem per etap.
import { GET, POST, slowniki } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badge, mln, dataPl } from '../ui.js';

export async function widokKomitet(kontener) {
  const kolejka = await GET('/komitet/kolejka');
  const odswiez = () => widokKomitet((kontener.innerHTML = '', kontener));

  kontener.append(
    el('h1', {}, 'Komitet Ofertowy'),
    el('p', { class: 'podtytul' }, 'Decyzja BID / NO-BID na kamieniu M5 (nowy klient) lub F3 (powracający). BID potwierdza kamień i rejestruje ZOS; NO-BID zamyka temat z powodem. Wysoki scoring nie oznacza automatycznego BID.'),

    el('h2', {}, `Kolejka do decyzji (${kolejka.length})`),
    kolejka.length ? tabela([
      { naglowek: 'Kamień', klasa: 'wysrodkuj', render: w => badge(w.kamien_kod, 'akcent') },
      { naglowek: 'Temat', render: w => el('b', {}, w.identyfikator) },
      { naglowek: 'Klient', render: w => w.klient_nazwa || '—' },
      { naglowek: 'Wartość kontraktu', klasa: 'liczba', render: w => w.wartosc_kontraktu ? mln(w.wartosc_kontraktu) : '—' },
      { naglowek: 'Prawd.', klasa: 'liczba', render: w => w.prawdopodobienstwo + '%' },
      {
        naglowek: '', render: w => el('div', { style: 'display:flex; gap:6px' },
          el('button', { class: 'btn btn-glowny btn-maly', onclick: (e) => { e.stopPropagation(); decyzjaBid(w, odswiez); } }, 'BID'),
          el('button', { class: 'btn btn-czerwony btn-maly', onclick: (e) => { e.stopPropagation(); decyzjaNoBid(w, odswiez); } }, 'NO-BID'))
      },
    ], kolejka, w => location.hash = '#/tematy/' + w.id)
      : el('div', { class: 'karta-box puste' }, 'Kolejka pusta. Temat trafia tu, gdy dojdzie do kamienia M5 / F3 (zaproszenie do oferty = ZOS).'),

    el('div', { class: 'info-box', style: 'margin-top:14px' },
      'Materiały na Komitet: szablon 1/2 A4, 24 h przed posiedzeniem. Zasada: nie ofertujemy bez decyzji Komitetu. Historia decyzji jest w historii każdego tematu (audyt).'),
  );
}

function decyzjaBid(t, odswiez) {
  const dowod = el('textarea', {}, `Decyzja Komitetu: BID. ${t.definicja_spelnienia || ''}`.trim());
  const kto = el('input', { value: t.handlowiec || '', placeholder: 'kto potwierdza' });
  modal(`BID — potwierdź kamień ${t.kamien_kod}`, el('div', {},
    el('div', { class: 'info-box' }, 'BID potwierdza kamień (rejestracja ZOS w Intense) i przenosi temat do fazy ofertowania. Uzupełnij wartość kontraktu na temacie, jeśli jeszcze pusta.'),
    el('div', { class: 'pole' }, el('label', {}, 'Dowód / uzasadnienie decyzji *'), dowod),
    el('div', { class: 'pole', style: 'margin-top:8px' }, el('label', {}, 'Potwierdzający'), kto)),
    [['Zatwierdź BID', 'btn-glowny', async () => {
      if (!dowod.value.trim()) { toast('Dowód jest wymagany', true); return false; }
      const r = await POST(`/tematy/${t.id}/potwierdz-kamien`, { kamien_id: t.akt_kamien_id, dowod: dowod.value, potwierdzajacy: kto.value || null });
      toast(`BID — ${t.kamien_kod} potwierdzony → ${r.prawdopodobienstwo}%`); odswiez();
    }]]);
}

async function decyzjaNoBid(t, odswiez) {
  const powody = await GET('/powody-zamkniecia?kamien_kod=' + encodeURIComponent(t.kamien_kod));
  const form = el('div', { class: 'form-siatka' },
    pole({
      name: 'powod_id', label: 'Powód NO-BID (słownik etapu) — recyklingowalny wróci automatycznie',
      typ: 'select', wymagane: true, opcje: powody.map(p => [p.id, p.nazwa + (p.czy_recyklingowalny ? ` ♻ +${p.offset_powrotu_mies}mc` : '')])
    }),
    pole({ name: 'opis', label: 'Uzasadnienie / notatka z posiedzenia', typ: 'textarea', szerokie: true }));
  modal(`NO-BID — zamknij temat ${t.identyfikator}`, form, [['Zapisz NO-BID', 'btn-czerwony', async () => {
    const d = zbierzForm(form);
    if (!d.powod_id) { toast('Powód jest obowiązkowy', true); return false; }
    const r = await POST(`/tematy/${t.id}/zamknij`, { status: 'przegrany', powod_id: d.powod_id, opis: d.opis });
    toast(r.recycled ? `NO-BID → recykling, powrót ${r.recycle_date}` : 'NO-BID — temat zamknięty'); odswiez();
  }]]);
}
