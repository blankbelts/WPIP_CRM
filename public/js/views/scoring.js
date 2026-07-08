// Zakladka "Scoring leadow" - wersje scoringu (odpowiednik arkusza Parametry) + grupy leadow
import { GET, POST, PUT, DEL } from '../api.js';
import { el, modal, pole, zbierzForm, toast, tabela, badge } from '../ui.js';

export async function widokScoring(kontener) {
  const [{ wersje, komponenty, nazwy_komponentow }, grupy] = await Promise.all([GET('/wersje'), GET('/grupy')]);
  const odswiez = () => widokScoring((kontener.innerHTML = '', kontener));

  kontener.append(
    el('h1', {}, 'Scoring leadów'),
    el('p', { class: 'podtytul' },
      'Wersje scoringu = arkusz Parametry: wagi komponentów A–F i progi priorytetów. Wersja użyta do przeliczenia zostaje zamrożona — zmiany wprowadzasz przez duplikat.'),

    // ---- GRUPY ----
    el('div', { class: 'karta-box' },
      el('div', { class: 'naglowek-akcje' },
        el('h2', { style: 'margin-top:0' }, 'Grupy leadów (załadowane bazy)'),
        el('button', { class: 'btn btn-glowny btn-maly', onclick: () => formularzGrupy(wersje, null, odswiez) }, '+ Nowa grupa')),
      grupy.length ? tabela([
        { naglowek: 'Grupa', render: g => el('b', {}, g.nazwa) },
        { naglowek: 'Leady', klasa: 'liczba', render: g => String(g.liczba_leadow) },
        {
          naglowek: 'Priorytety', render: g => el('span', {},
            ...['A', 'B', 'C', 'D', 'X'].filter(p => g.priorytety[p]).map(p =>
              el('span', { class: 'badge badge-' + p.toLowerCase(), style: 'margin-right:4px' }, `${p}:${g.priorytety[p]}`)))
        },
        { naglowek: 'Wystąpienia z innych baz', klasa: 'liczba', render: g => String(g.liczba_wystapien) },
        {
          naglowek: 'Wersja scoringu', render: g => el('span', {}, g.wersja_nazwa || '—', ' ',
            g.wersja_status === 'robocza' ? badge('robocza', 'zolty') : '')
        },
        {
          naglowek: '', render: g => el('span', { style: 'display:flex; gap:6px' },
            el('button', {
              class: 'btn btn-maly', onclick: (e) => { e.stopPropagation(); formularzGrupy(wersje, g, odswiez); }
            }, 'Edytuj'),
            el('button', {
              class: 'btn btn-maly btn-glowny', onclick: async (e) => {
                e.stopPropagation(); e.target.disabled = true;
                try {
                  const r = await POST(`/grupy/${g.id}/przelicz`, {});
                  toast(`Przeliczono ${r.przeliczono} leadów, zmiany priorytetu: ${r.zmiany_priorytetu}`);
                  odswiez();
                } catch (err) { toast(err.message, true); e.target.disabled = false; }
              }
            }, 'Przelicz'),
            el('a', { class: 'btn btn-maly', href: '#/leady?grupa=' + g.id, onclick: (e) => e.stopPropagation() }, 'Leady →'))
        },
      ], grupy) : el('div', { class: 'puste' }, 'Brak grup — pierwsza powstanie przy imporcie bazy lub utwórz ręcznie')),

    // ---- WERSJE ----
    el('div', { class: 'naglowek-akcje' },
      el('h2', {}, 'Wersje scoringu'),
      el('button', { class: 'btn btn-glowny btn-maly', onclick: () => formularzWersji(wersje, odswiez) }, '+ Nowa wersja (duplikat)')),
    ...wersje.map(w => kartaWersji(w, komponenty, nazwy_komponentow, odswiez)),
  );
}

function kartaWersji(w, komponenty, nazwy, odswiez) {
  const robocza = w.status === 'robocza';
  const zapiszProg = (poleNazwa) => async (v) => { await PUT('/wersje/' + w.id, { [poleNazwa]: Number(v) }); };

  return el('div', { class: 'karta-box' },
    el('div', { class: 'naglowek-akcje' },
      el('h2', { style: 'margin-top:0' }, w.nazwa, ' ',
        robocza ? badge('robocza — edytowalna', 'zolty') : badge('zamrożona (audyt)', 'nieb')),
      el('span', { style: 'color:var(--tekst-2); font-size:12px' },
        `${w.liczba_grup} grup · ${w.liczba_leadow} leadów policzonych tą wersją`)),
    w.opis ? el('p', { style: 'color:var(--tekst-2); margin:4px 0 12px' }, w.opis) : '',

    el('div', { class: 'filtry', style: 'gap:16px' },
      el('span', {}, el('b', {}, 'Progi priorytetów: '), 'A ≥ '),
      robocza ? edytowalne(String(w.prog_a), zapiszProg('prog_a'), odswiez) : el('b', {}, String(w.prog_a)),
      el('span', {}, ' · B ≥ '),
      robocza ? edytowalne(String(w.prog_b), zapiszProg('prog_b'), odswiez) : el('b', {}, String(w.prog_b)),
      el('span', {}, ' · C ≥ '),
      robocza ? edytowalne(String(w.prog_c), zapiszProg('prog_c'), odswiez) : el('b', {}, String(w.prog_c)),
      el('span', { style: 'color:var(--tekst-2)' }, ' · D poniżej · X = dyskwalifikacja')),

    el('div', { style: 'display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:14px; margin-top:10px' },
      ...komponenty.map(komp => {
        const opcje = w.opcje[komp] || [];
        const max = Math.max(0, ...opcje.filter(o => !o.dyskwalifikacja).map(o => o.punkty));
        return el('div', {},
          el('h2', { style: 'font-size:13px; margin:4px 0 6px' }, nazwy[komp] || komp,
            el('span', { style: 'color:var(--tekst-2); font-weight:400' }, ` (max ${max})`)),
          tabela([
            { naglowek: 'Opcja', render: o => (o.dyskwalifikacja ? '⛔ ' : '') + o.etykieta },
            {
              naglowek: 'Pkt', klasa: 'liczba', render: o => robocza
                ? edytowalne(String(o.punkty), async (v) => { await PUT('/wersje-opcje/' + o.id, { punkty: Number(v) }); }, odswiez)
                : String(o.punkty)
            },
            ...(robocza ? [{
              naglowek: '', klasa: 'wysrodkuj', render: o => el('button', {
                class: 'btn btn-maly btn-czerwony', title: 'usuń opcję',
                onclick: async () => { try { await DEL('/wersje-opcje/' + o.id); odswiez(); } catch (e) { toast(e.message, true); } }
              }, '×')
            }] : []),
          ], opcje),
          robocza ? el('button', {
            class: 'btn btn-maly', style: 'margin-top:6px',
            onclick: () => {
              const form = el('div', { class: 'form-siatka' },
                pole({ name: 'etykieta', label: 'Etykieta opcji', wymagane: true }),
                pole({ name: 'punkty', label: 'Punkty', typ: 'number', wartosc: 0 }),
                pole({ name: 'dyskwalifikacja', label: 'Dyskwalifikacja (X)?', typ: 'select', pusta: false, opcje: [[0, 'Nie'], [1, 'Tak — priorytet X']] }));
              modal(`Nowa opcja — ${nazwy[komp] || komp}`, form, [['Dodaj', 'btn-glowny', async () => {
                const d = zbierzForm(form);
                if (!d.etykieta) { toast('Etykieta wymagana', true); return false; }
                await POST(`/wersje/${w.id}/opcje`, { komponent: komp, ...d });
                odswiez();
              }]]);
            }
          }, '+ opcja') : '');
      })));
}

function formularzWersji(wersje, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa nowej wersji', wymagane: true, placeholder: 'np. v7 — komponent OZE' }),
    pole({
      name: 'zrodlo_id', label: 'Duplikuj z wersji', typ: 'select', pusta: false,
      wartosc: wersje[0]?.id, opcje: wersje.map(w => [w.id, w.nazwa]),
      pomoc: 'Nowa wersja startuje jako kopia (opcje + progi) w statusie roboczym'
    }),
    pole({ name: 'opis', label: 'Opis / co zmienia ta wersja', typ: 'textarea', szerokie: true }));
  modal('Nowa wersja scoringu', form, [['Utwórz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    await POST('/wersje', d);
    toast('Wersja utworzona (robocza)'); odswiez();
  }]]);
}

function formularzGrupy(wersje, grupa, odswiez) {
  const form = el('div', { class: 'form-siatka' },
    pole({ name: 'nazwa', label: 'Nazwa grupy', wymagane: true, wartosc: grupa?.nazwa, placeholder: 'np. v6 — region północny' }),
    pole({
      name: 'wersja_id', label: 'Wersja scoringu', typ: 'select', pusta: false,
      wartosc: grupa?.wersja_id ?? wersje[0]?.id, opcje: wersje.map(w => [w.id, `${w.nazwa} (${w.status})`]),
      pomoc: 'Zmiana wersji nie przelicza automatycznie — użyj „Przelicz" po zapisie'
    }),
    pole({ name: 'opis', label: 'Opis', typ: 'textarea', wartosc: grupa?.opis, szerokie: true }));
  modal(grupa ? 'Edytuj grupę' : 'Nowa grupa leadów', form, [['Zapisz', 'btn-glowny', async () => {
    const d = zbierzForm(form);
    if (!d.nazwa) { toast('Nazwa wymagana', true); return false; }
    if (grupa) await PUT('/grupy/' + grupa.id, d);
    else await POST('/grupy', d);
    toast('Grupa zapisana'); odswiez();
  }]]);
}

// Inline-edycja liczby/tekstu
function edytowalne(wartosc, zapisz, odswiez) {
  const span = el('span', { class: 'link', title: 'kliknij aby edytować' }, wartosc);
  span.addEventListener('click', () => {
    const input = el('input', { type: 'number', value: wartosc, style: 'width:80px' });
    span.replaceWith(input);
    input.focus();
    let zapisano = false;
    const commit = async () => {
      if (zapisano) return; zapisano = true;
      try { await zapisz(input.value); toast('Zapisano'); odswiez(); }
      catch (e) { toast(e.message, true); odswiez(); }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    input.addEventListener('blur', commit);
  });
  return span;
}
