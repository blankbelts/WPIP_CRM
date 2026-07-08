// Kartoteka klientow i osob kontaktowych
import { GET, POST, PUT, slowniki } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badge, badgeStatus, badgePriorytet, dataPl, mln, pct } from '../ui.js';
import { formularzDzialania, listaDzialan } from './dzialania.js';

export async function widokKlienci(kontener) {
  const [klienci, sl] = await Promise.all([GET('/klienci'), slowniki()]);

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Klienci'),
        el('p', { class: 'podtytul' }, '75-80% przychodu WPIP pochodzi od klientów powracających — rozdzielenie AM od New Business jest fundamentalne')),
      el('button', { class: 'btn btn-glowny', onclick: () => formularzKlienta(sl, null, () => location.reload()) }, '+ Nowy klient')),
    tabela([
      { naglowek: 'Nazwa', render: w => w.nazwa },
      { naglowek: 'Typ', render: w => w.klient_powracajacy ? badge('powracający', 'zielony') : badge('nowy (NB)', 'nieb') },
      { naglowek: 'Branża', render: w => w.branza || '—' },
      { naglowek: 'Lokalizacja', render: w => [w.miasto, w.wojewodztwo].filter(Boolean).join(', ') || '—' },
      { naglowek: 'Potencjał OZE', render: w => w.potencjal_oze || '—' },
      { naglowek: 'Opiekun konta', render: w => w.opiekun || '—' },
      { naglowek: 'Tematy', klasa: 'wysrodkuj', render: w => String(w.liczba_tematow) },
      { naglowek: 'Leady', klasa: 'wysrodkuj', render: w => String(w.liczba_leadow) },
      { naglowek: '', render: w => w.dyskwalifikacja ? badge('⛔ dyskwalifikacja', 'czerwony') : '' },
    ], klienci, w => location.hash = '#/klienci/' + w.id));
}

export async function widokKlient(kontener, id) {
  const [k, sl] = await Promise.all([GET('/klienci/' + id), slowniki()]);
  const odswiez = () => widokKlient((kontener.innerHTML = '', kontener), id);

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, k.nazwa, ' ',
          k.klient_powracajacy ? badge('powracający', 'zielony') : badge('nowy (NB)', 'nieb'),
          k.dyskwalifikacja ? badge('⛔ dyskwalifikacja', 'czerwony') : ''),
        el('p', { class: 'podtytul' }, [k.branza, k.miasto, k.wojewodztwo].filter(Boolean).join(' · ') || 'Kartoteka klienta')),
      el('div', { style: 'display:flex; gap:8px;' },
        el('button', { class: 'btn', onclick: () => formularzKlienta(sl, k, odswiez) }, 'Edytuj'),
        el('button', { class: 'btn', onclick: () => formularzOsoby(k.id, null, odswiez) }, '+ Osoba'),
        el('button', { class: 'btn btn-glowny', onclick: () => formularzDzialania({ klient_id: k.id }, odswiez) }, '+ Działanie'))),

    k.dyskwalifikacja ? el('div', { class: 'ostrzezenie' }, '⛔ Klient zdyskwalifikowany: ', k.powod_dyskwalifikacji || 'decyzja strategiczna') : '',

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Dane klienta'),
      el('div', { class: 'szczegoly' },
        poz('NIP', k.nip || '—'),
        poz('Skąd pozyskany', k.zrodlo_pozyskania || '—'),
        poz('Opiekun konta', k.opiekun || '—'),
        poz('Potencjał OZE (GW-first, potem cross-sell)', k.potencjal_oze || '—'),
        poz('Utworzono', dataPl(k.utworzono))),
      k.notatki ? el('div', { style: 'margin-top:10px' }, poz('Notatki', k.notatki)) : null),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, `Osoby kontaktowe (${k.osoby.length})`),
      tabela([
        { naglowek: 'Imię i nazwisko', render: w => w.imie_nazwisko },
        { naglowek: 'Stanowisko', render: w => w.stanowisko || '—' },
        { naglowek: 'Rola w decyzji', render: w => w.rola_w_decyzji || '—' },
        { naglowek: 'E-mail', render: w => w.email || '—' },
        { naglowek: 'Telefon', render: w => w.telefon || '—' },
        { naglowek: '', render: w => el('button', { class: 'btn btn-maly', onclick: (e) => { e.stopPropagation(); formularzOsoby(k.id, w, odswiez); } }, 'Edytuj') },
      ], k.osoby)),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, `Tematy sprzedażowe (${k.tematy.length})`),
      tabela([
        { naglowek: 'Identyfikator', render: w => w.identyfikator },
        { naglowek: 'Wartość', klasa: 'liczba', render: w => mln(w.wartosc_kontraktu) },
        { naglowek: '% wygranej', klasa: 'liczba', render: w => pct(w.prawdopodobienstwo) },
        { naglowek: 'Status', render: w => badgeStatus(w.status) },
      ], k.tematy, w => location.hash = '#/tematy/' + w.id)),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, `Leady (${k.leady.length})`),
      tabela([
        { naglowek: 'Nazwa', render: w => w.nazwa },
        { naglowek: 'Priorytet', klasa: 'wysrodkuj', render: w => badgePriorytet(w.priorytet) },
        { naglowek: 'Kamień', render: w => w.kamien },
        { naglowek: 'Status', render: w => badgeStatus(w.status) },
      ], k.leady, w => location.hash = '#/leady/' + w.id)),

    el('div', { class: 'karta-box' },
      el('h2', { style: 'margin-top:0' }, 'Działania'),
      listaDzialan(k.dzialania, odswiez)),
  );
}

function poz(et, wa) {
  return el('div', { class: 'poz' }, el('div', { class: 'et' }, et), el('div', { class: 'wa' }, wa));
}

function formularzKlienta(sl, k, poZapisie) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa firmy', wymagane: true, wartosc: k?.nazwa }),
    pole({ name: 'nip', label: 'NIP', wartosc: k?.nip }),
    pole({ name: 'zrodlo_pozyskania', label: 'Skąd pozyskany', typ: 'select', wartosc: k?.zrodlo_pozyskania, opcje: (sl.zrodlo_leada || []).map(z => z.wartosc) }),
    pole({ name: 'klient_powracajacy', label: 'Klient powracający', typ: 'select', wartosc: k?.klient_powracajacy ?? 0, pusta: false, opcje: [[0, 'Nie — New Business'], [1, 'Tak — konto powracające']] }),
    pole({ name: 'opiekun', label: 'Opiekun konta', wartosc: k?.opiekun, pomoc: 'Może być inny niż handlowiec konkretnego tematu' }),
    pole({ name: 'branza', label: 'Branża', wartosc: k?.branza }),
    pole({ name: 'miasto', label: 'Miasto', wartosc: k?.miasto }),
    pole({ name: 'wojewodztwo', label: 'Województwo', wartosc: k?.wojewodztwo }),
    pole({ name: 'potencjal_oze', label: 'Potencjał OZE', typ: 'select', wartosc: k?.potencjal_oze ?? 'nie oceniono', pusta: false, opcje: ['nie oceniono', 'tak', 'nie', 'w toku'], pomoc: 'Cross-sell Green Energy: najpierw GW, potem OZE' }),
    pole({ name: 'dyskwalifikacja', label: 'Dyskwalifikacja strategiczna', typ: 'select', wartosc: k?.dyskwalifikacja ?? 0, pusta: false, opcje: [[0, 'Nie'], [1, 'Tak (np. CTP, in-house GW)']] }),
    pole({ name: 'powod_dyskwalifikacji', label: 'Powód dyskwalifikacji', wartosc: k?.powod_dyskwalifikacji }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: k?.notatki, szerokie: true }));

  modal(k ? 'Edytuj klienta' : 'Nowy klient', form, [
    ['Zapisz', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (!d.nazwa) { toast('Nazwa firmy jest wymagana', true); return false; }
      if (k) await PUT('/klienci/' + k.id, d);
      else await POST('/klienci', d);
      toast('Klient zapisany'); poZapisie?.();
    }],
  ]);
}

function formularzOsoby(klientId, o, poZapisie) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'imie_nazwisko', label: 'Imię i nazwisko', wymagane: true, wartosc: o?.imie_nazwisko }),
    pole({ name: 'stanowisko', label: 'Stanowisko', wartosc: o?.stanowisko }),
    pole({
      name: 'rola_w_decyzji', label: 'Rola w decyzji (DMU)', typ: 'select', wartosc: o?.rola_w_decyzji,
      opcje: ['decydent', 'wpływowy', 'użytkownik', 'strażnik']
    }),
    pole({ name: 'email', label: 'E-mail', typ: 'email', wartosc: o?.email }),
    pole({ name: 'telefon', label: 'Telefon', wartosc: o?.telefon }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: o?.notatki, szerokie: true }));

  modal(o ? 'Edytuj osobę' : 'Nowa osoba kontaktowa', form, [
    ['Zapisz', 'btn-glowny', async () => {
      const d = zbierzForm(form);
      if (!d.imie_nazwisko) { toast('Imię i nazwisko jest wymagane', true); return false; }
      d.klient_id = klientId;
      if (o) await PUT('/osoby/' + o.id, d);
      else await POST('/osoby', d);
      toast('Osoba zapisana'); poZapisie?.();
    }],
  ]);
}
