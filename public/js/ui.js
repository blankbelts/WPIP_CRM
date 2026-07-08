// Male helpery UI - budowanie DOM, modale, toasty, formatowanie
export function el(tag, attrs = {}, ...dzieci) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const d of dzieci.flat(Infinity)) {
    if (d === null || d === undefined || d === false) continue;
    node.append(d.nodeType ? d : document.createTextNode(d));
  }
  return node;
}

export function toast(tekst, blad = false) {
  const t = el('div', { class: 'toast' + (blad ? ' blad' : '') }, tekst);
  document.getElementById('toast-root').append(t);
  setTimeout(() => t.remove(), blad ? 6000 : 3500);
}

export function modal(tytul, tresc, przyciski = []) {
  const root = document.getElementById('modal-root');
  const zamknij = () => root.innerHTML = '';
  const box = el('div', { class: 'modal' },
    el('h2', {}, tytul),
    tresc,
    el('div', { class: 'modal-stopka' },
      el('button', { class: 'btn', onclick: zamknij }, 'Anuluj'),
      ...przyciski.map(([label, klasa, fn]) =>
        el('button', {
          class: 'btn ' + klasa, onclick: async (e) => {
            e.target.disabled = true;
            try { const ok = await fn(); if (ok !== false) zamknij(); }
            catch (err) { toast(err.message, true); }
            finally { e.target.disabled = false; }
          }
        }, label)),
    ));
  const tlo = el('div', { class: 'modal-tlo', onclick: (e) => { if (e.target === tlo) zamknij(); } }, box);
  root.innerHTML = '';
  root.append(tlo);
  return zamknij;
}

// Pole formularza: {name, label, typ, opcje, wartosc, pomoc, wymagane, szerokie}
export function pole(p) {
  let input;
  if (p.typ === 'select') {
    input = el('select', { name: p.name },
      ...(p.pusta !== false ? [el('option', { value: '' }, p.pusta || '— wybierz —')] : []),
      ...p.opcje.map(o => {
        const [val, label] = Array.isArray(o) ? o : [o, o];
        return el('option', { value: val, selected: String(p.wartosc ?? '') === String(val) }, label);
      }));
  } else if (p.typ === 'textarea') {
    input = el('textarea', { name: p.name }, p.wartosc ?? '');
  } else {
    input = el('input', {
      name: p.name, type: p.typ || 'text', value: p.wartosc ?? '',
      step: p.step, min: p.min, max: p.max, placeholder: p.placeholder,
    });
  }
  if (p.onchange) input.addEventListener('change', p.onchange);
  return el('div', { class: 'pole' + (p.szerokie ? ' pole-szerokie' : '') },
    el('label', {}, p.label + (p.wymagane ? ' *' : '')),
    input,
    p.pomoc ? el('div', { class: 'pomoc' }, p.pomoc) : null);
}

export function zbierzForm(form) {
  const dane = {};
  for (const input of form.querySelectorAll('input, select, textarea')) {
    if (!input.name) continue;
    let v = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.value;
    if (v === '') v = null;
    else if (input.type === 'number') v = Number(v);
    dane[input.name] = v;
  }
  return dane;
}

export const mln = (v) => v || v === 0 ? (Number(v)).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' mln' : '—';
export const pct = (v) => v || v === 0 ? v + '%' : '—';
export const dataPl = (d) => d ? new Date(d).toLocaleDateString('pl-PL') : '—';

export function badge(tekst, klasa) {
  return el('span', { class: 'badge badge-' + klasa }, tekst);
}

export function badgePriorytet(p) {
  const opisy = { A: 'A — kontakt teraz', B: 'B — obserwuj / grzej', C: 'C — długi termin', D: 'D — poza profilem', X: 'X — dyskwalifikacja' };
  return el('span', { class: 'badge badge-' + p.toLowerCase(), title: opisy[p] || '' }, p);
}

export function badgeStatus(s) {
  const mapa = {
    otwarty: 'nieb', wygrany: 'zielony', przegrany: 'czerwony', odrzucony: 'szary', wstrzymany: 'zolty',
    aktywny: 'nieb', 'przekazany do pipeline': 'zielony', odpuszczony: 'szary', uspiony: 'zolty',
    planowane: 'nieb', wykonane: 'zielony', odwolane: 'szary',
  };
  return badge(s, mapa[s] || 'szary');
}

export function pasekPrawd(p) {
  return el('div', { class: 'pasek', title: p + '%' }, el('div', { style: `width:${p}%` }));
}

export function tabela(kolumny, wiersze, onKlik) {
  if (!wiersze.length) return el('div', { class: 'puste' }, 'Brak danych do wyświetlenia');
  return el('table', {},
    el('thead', {}, el('tr', {}, ...kolumny.map(k => el('th', { class: k.klasa || '' }, k.naglowek)))),
    el('tbody', {}, ...wiersze.map(w =>
      el('tr', {
        class: onKlik ? 'klikalne' : '',
        onclick: onKlik ? () => onKlik(w) : undefined,
      }, ...kolumny.map(k => el('td', { class: k.klasa || '' }, k.render(w)))))));
}
