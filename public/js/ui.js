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

// Awatar z inicjalami (np. "K. Latoś" -> KL); kolor deterministyczny z nazwy
export function awatar(nazwa) {
  const n = String(nazwa || '?').trim();
  const inicjaly = n.split(/[\s.]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || '?';
  const KOLORY = ['#1f3a5c', '#3d6fd0', '#0f766e', '#7c3aed', '#b45309', '#be185d'];
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return el('span', { class: 'awatar', title: n, style: `background:${KOLORY[h % KOLORY.length]}` }, inicjaly);
}

// Przelacznik on/off (Livespace-style toggle)
export function przelacznik(checked, onZmiana, disabled = false) {
  const input = el('input', { type: 'checkbox', disabled });
  input.checked = !!checked;
  if (onZmiana) input.addEventListener('change', () => onZmiana(input.checked));
  return el('label', { class: 'przelacznik', onclick: (e) => e.stopPropagation() }, input, el('span', { class: 'tor' }));
}

// Pierscien postepu (donut SVG) - procent 0-100+, pelny (>=100) na zielono
export function ring(procent, rozmiar = 64, etykieta = null) {
  const rzeczywisty = Math.max(0, Math.round(procent));
  const p = Math.min(150, rzeczywisty);
  if (etykieta === null) etykieta = rzeczywisty + '%';
  const r = (rozmiar - 8) / 2, obw = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', rozmiar); svg.setAttribute('height', rozmiar);
  svg.setAttribute('viewBox', `0 0 ${rozmiar} ${rozmiar}`);
  svg.classList.add('ring');
  const c = rozmiar / 2;
  svg.innerHTML = `
    <circle class="ring-tlo" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="6"/>
    <circle class="ring-wart${p >= 100 ? ' pelny' : ''}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="6"
      stroke-linecap="round" stroke-dasharray="${obw}" stroke-dashoffset="${obw * (1 - Math.min(p, 100) / 100)}"
      transform="rotate(-90 ${c} ${c})"/>
    <text x="${c}" y="${c + 4}" text-anchor="middle" font-size="${rozmiar / 4.6}">${etykieta ?? p + '%'}</text>`;
  return svg;
}

// Segmentowany wskaznik etapu na karcie (ile kamieni zaliczonych z ilu)
export function segmenty(zaliczone, aktualnyIdx, total) {
  return el('div', { class: 'segmenty', title: `etap ${aktualnyIdx + 1} z ${total}` },
    ...Array.from({ length: total }, (_, i) =>
      el('span', { class: i < zaliczone ? 'zaliczony' : (i === aktualnyIdx ? 'aktualny' : '') })));
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
