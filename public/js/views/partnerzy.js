// Partnerzy biznesowi (ambasadorzy, posrednicy, biura arch., inwestorzy zastepczy, zarzadcy)
// Sciezka z tablicy PARTNERZY: research -> weryfikacja telefoniczna -> spotkanie -> profil w bazie
import { GET, POST, PUT, slowniki } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badge } from '../ui.js';

export async function widokPartnerzy(kontener) {
  const [partnerzy, sl] = await Promise.all([GET('/partnerzy'), slowniki()]);
  const etapy = (sl.etap_partnera || []).map(e => e.wartosc);
  const odswiez = () => widokPartnerzy((kontener.innerHTML = '', kontener));

  const badgeEtap = (e) => badge(e || '—', e === 'Profil w bazie (aktywny)' ? 'zielony' : e === 'Odrzucony' ? 'czerwony' : e === 'Spotkanie' ? 'nieb' : 'szary');

  kontener.append(
    el('div', { class: 'naglowek-akcje' },
      el('div', {},
        el('h1', {}, 'Partnerzy biznesowi'),
        el('p', { class: 'podtytul' }, 'Ambasadorzy, pośrednicy, biura architektoniczne, inwestorzy zastępczy, zarządcy — kanał multiplikujący dostęp do klientów końcowych')),
      el('button', { class: 'btn btn-glowny', onclick: () => formularz(sl, null, odswiez) }, '+ Nowy partner')),

    // Kanban etapow
    el('div', { class: 'kanban' },
      ...etapy.map(etap => {
        const wKol = partnerzy.filter(p => p.etap === etap);
        return el('div', { class: 'kanban-kolumna' },
          el('div', { class: 'kanban-naglowek' }, el('span', {}, etap), el('span', {}, String(wKol.length))),
          ...wKol.map(p => el('div', { class: 'kanban-karta', onclick: () => formularz(sl, p, odswiez) },
            el('div', { class: 'kk-id' }, p.nazwa),
            el('div', { class: 'kk-info' }, el('span', {}, p.typ || ''), el('span', {}, p.osoba_kontakt || '')))));
      })),

    el('h2', {}, 'Wszyscy partnerzy'),
    partnerzy.length ? tabela([
      { naglowek: 'Nazwa', render: p => el('b', {}, p.nazwa) },
      { naglowek: 'Typ', render: p => p.typ || '—' },
      { naglowek: 'Kontakt', render: p => p.osoba_kontakt || '—' },
      { naglowek: 'Telefon', render: p => p.telefon || '—' },
      { naglowek: 'Etap', render: p => badgeEtap(p.etap) },
      { naglowek: 'Potencjał', render: p => (p.potencjal || '—').slice(0, 40) },
    ], partnerzy, p => formularz(sl, p, odswiez))
      : el('div', { class: 'karta-box puste' }, 'Brak partnerów. Dodaj pierwszego przyciskiem „+ Nowy partner".'));
}

function formularz(sl, partner, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa / firma', wymagane: true, wartosc: partner?.nazwa, szerokie: true }),
    pole({ name: 'typ', label: 'Typ partnera', typ: 'select', opcje: (sl.typ_partnera || []).map(t => t.wartosc), wartosc: partner?.typ }),
    pole({ name: 'etap', label: 'Etap', typ: 'select', pusta: false, opcje: (sl.etap_partnera || []).map(e => e.wartosc), wartosc: partner?.etap || 'Research' }),
    pole({ name: 'osoba_kontakt', label: 'Osoba kontaktowa', wartosc: partner?.osoba_kontakt }),
    pole({ name: 'email', label: 'E-mail', typ: 'email', wartosc: partner?.email }),
    pole({ name: 'telefon', label: 'Telefon', wartosc: partner?.telefon }),
    pole({ name: 'potencjal', label: 'Potencjał / obszar współpracy', typ: 'textarea', wartosc: partner?.potencjal, szerokie: true }),
    pole({ name: 'notatki', label: 'Notatki', typ: 'textarea', wartosc: partner?.notatki, szerokie: true }));
  modal(partner ? 'Edytuj partnera' : 'Nowy partner', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa jest wymagana', true); return false; }
    if (partner) await PUT('/partnerzy/' + partner.id, d);
    else await POST('/partnerzy', d);
    toast('Zapisano'); odswiez();
  }]]);
}
