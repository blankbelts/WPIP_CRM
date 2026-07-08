// Komitet Ofertowy - bramka bid / no bid / defer
// Scoring jest WEJSCIEM do decyzji, nie sama decyzja. Kazda decyzja no-bid/defer ma obowiazkowy powod.
import { GET, POST, slowniki, karty } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badgePriorytet, dataPl, mln } from '../ui.js';
import { badgeDecyzja } from './leady.js';

export async function widokKomitet(kontener) {
  const [kolejka, decyzje, sl] = await Promise.all([
    GET('/komitet/kolejka'), GET('/komitet/decyzje'), slowniki()]);

  kontener.append(
    el('h1', {}, 'Komitet Ofertowy'),
    el('p', { class: 'podtytul' }, 'Decyzja bid / no bid jest świadomym wyborem strategicznym — wysoki scoring nie oznacza automatycznego bid'),

    el('h2', {}, `Kolejka do decyzji (${kolejka.length})`),
    kolejka.length ? tabela([
      { naglowek: 'Priorytet', klasa: 'wysrodkuj', render: w => badgePriorytet(w.priorytet) },
      { naglowek: 'Scoring', klasa: 'liczba', render: w => String(w.score_total) },
      { naglowek: 'Lead', render: w => w.nazwa },
      { naglowek: 'Klient', render: w => w.klient_nazwa || '—' },
      { naglowek: 'Wartość inwestycji', klasa: 'liczba', render: w => w.wartosc_inwestycji ? mln(w.wartosc_inwestycji) : '—' },
      { naglowek: 'Dobry powód kontaktu', render: w => (w.dobry_powod_kontaktu || '—').slice(0, 60) },
      {
        naglowek: '', render: w => el('button', {
          class: 'btn btn-glowny btn-maly',
          onclick: (e) => { e.stopPropagation(); formularzDecyzji(w, sl, () => location.reload()); }
        }, 'Decyzja')
      },
    ], kolejka, w => location.hash = '#/leady/' + w.id)
      : el('div', { class: 'karta-box puste' }, 'Kolejka pusta. Lead trafia tutaj po osiągnięciu kamienia „Zakwalifikowany” w prospectingu.'),

    el('h2', {}, 'Historia decyzji'),
    tabela([
      { naglowek: 'Data', render: w => dataPl(w.data) },
      { naglowek: 'Lead', render: w => w.lead_nazwa || '—' },
      { naglowek: 'Decyzja', render: w => badgeDecyzja(w.decyzja) },
      { naglowek: 'Powód', render: w => w.powod || '—' },
      { naglowek: 'Uzasadnienie', render: w => w.uzasadnienie || '—' },
      { naglowek: 'Temat', render: w => w.temat_identyfikator ? el('a', { class: 'link', href: '#/tematy/' + w.temat_id }, w.temat_identyfikator) : '—' },
    ], decyzje));
}

async function formularzDecyzji(lead, sl, poZapisie) {
  const listaKart = await karty();
  const powody = (sl.powod_odpuszczenia || []).map(p => p.wartosc);
  const modele = (sl.model_realizacji || []).map(m => m.wartosc);

  // Sugestia identyfikatora Inwestor_TypInwestycji
  const sugestia = (lead.klient_nazwa || lead.nazwa.split(' ')[0] || 'Inwestor').replace(/\s+/g, '') + '_';

  const sekcjaBid = el('div', {},
    el('div', { class: 'info-box' }, 'Decyzja BID utworzy temat w pipeline (kamień startowy: Lead). Identyfikator Inwestor_TypInwestycji zostaje z tematem na całe życie — od sygnału po fakturę końcową.'),
    el('div', { class: 'form-siatka' },
      pole({ name: 'identyfikator', label: 'Identyfikator tematu (Inwestor_TypInwestycji)', wymagane: true, wartosc: sugestia, placeholder: 'np. Indykpol_rozbudowa' }),
      pole({ name: 'wartosc_kontraktu', label: 'Wartość kontraktu WPIP (mln PLN)', typ: 'number', step: '0.1', pomoc: 'Osobno od wartości całej inwestycji' }),
      pole({ name: 'marza_pct', label: 'Marża planowana (%)', typ: 'number', step: '0.1', wartosc: 9 }),
      pole({ name: 'model_realizacji', label: 'Model realizacji', typ: 'select', opcje: modele, wartosc: 'Generalne wykonawstwo', pusta: false }),
      pole({ name: 'karta_id', label: 'Proces sprzedaży (karta ratingu)', typ: 'select', opcje: listaKart.map(k => [k.id, k.nazwa]), wartosc: listaKart[0]?.id, pusta: false }),
      pole({ name: 'termin_oferty', label: 'Termin złożenia oferty', typ: 'date' }),
      pole({ name: 'termin_realizacji', label: 'Termin rozpoczęcia realizacji', typ: 'date' }),
      pole({ name: 'czas_trwania_mies', label: 'Czas trwania (miesiące)', typ: 'number', wartosc: 12 })));

  const sekcjaPowod = el('div', { style: 'display:none' },
    el('div', { class: 'form-siatka' },
      pole({ name: 'powod', label: 'Powód (obowiązkowy — podstawa analizy win/loss)', typ: 'select', opcje: powody, wymagane: true })));

  const wyborDecyzji = pole({
    name: 'decyzja', label: 'Decyzja Komitetu', typ: 'select', pusta: false,
    opcje: [['bid', 'BID — ofertujemy'], ['no_bid', 'NO BID — odpuszczamy'], ['defer', 'DEFER — dopytujemy klienta i wracamy']],
    onchange: (e) => {
      sekcjaBid.style.display = e.target.value === 'bid' ? '' : 'none';
      sekcjaPowod.style.display = e.target.value === 'bid' ? 'none' : '';
    },
  });

  const form = el('div', {},
    el('div', { class: 'szczegoly', style: 'margin-bottom:14px' },
      el('div', { class: 'poz' }, el('div', { class: 'et' }, 'Lead'), el('div', { class: 'wa' }, lead.nazwa)),
      el('div', { class: 'poz' }, el('div', { class: 'et' }, 'Scoring'), el('div', { class: 'wa' }, `${lead.score_total} pkt (priorytet ${lead.priorytet})`)),
      el('div', { class: 'poz' }, el('div', { class: 'et' }, 'Klient'), el('div', { class: 'wa' }, lead.klient_nazwa || '—'))),
    el('div', { class: 'form-siatka' }, wyborDecyzji),
    el('div', { style: 'height:10px' }),
    sekcjaBid, sekcjaPowod,
    el('div', { class: 'form-siatka', style: 'margin-top:10px' },
      pole({ name: 'uzasadnienie', label: 'Uzasadnienie / notatka z posiedzenia', typ: 'textarea', szerokie: true })));

  modal('Decyzja Komitetu Ofertowego', form, [
    ['Zapisz decyzję', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (d.decyzja !== 'bid' && !d.powod) { toast('Powód jest obowiązkowy dla NO BID / DEFER', true); return false; }
      if (d.decyzja === 'bid' && (!d.identyfikator || d.identyfikator.endsWith('_'))) {
        toast('Uzupełnij identyfikator tematu (Inwestor_TypInwestycji)', true); return false;
      }
      await POST('/komitet/decyzja', {
        lead_id: lead.id, decyzja: d.decyzja, powod: d.powod, uzasadnienie: d.uzasadnienie,
        temat: d.decyzja === 'bid' ? {
          identyfikator: d.identyfikator, wartosc_kontraktu: d.wartosc_kontraktu, marza_pct: d.marza_pct,
          model_realizacji: d.model_realizacji, karta_id: d.karta_id, termin_oferty: d.termin_oferty,
          termin_realizacji: d.termin_realizacji, czas_trwania_mies: d.czas_trwania_mies,
        } : undefined,
      });
      toast(d.decyzja === 'bid' ? 'BID — temat utworzony w pipeline' : 'Decyzja zapisana');
      poZapisie?.();
    }],
  ]);
}
