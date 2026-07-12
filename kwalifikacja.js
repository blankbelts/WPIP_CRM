// Kwalifikacja wstepna (szybka triage) + generator wspolnego ID tematu
import { db } from './db.js';

// Sugerowany werdykt na podstawie odpowiedzi tak/nie/? na pytania kwalifikacji.
// Pytanie oznaczone jako dyskwalifikujace + odpowiedz "nie" => odpuszczenie.
export function werdyktKwalifikacji(odpowiedzi) {
  const pytania = db.prepare('SELECT * FROM pytania_kwalifikacji WHERE aktywny = 1').all();
  let tak = 0, nie = 0, brak = 0, dyskwalifikacja = false;
  for (const p of pytania) {
    const a = odpowiedzi[p.id] || odpowiedzi[String(p.id)];
    if (a === 'tak') tak++;
    else if (a === 'nie') { nie++; if (p.dyskwalifikujace) dyskwalifikacja = true; }
    else brak++;
  }
  if (dyskwalifikacja) return { werdykt: 'odpuszczony', tak, nie, brak, powod: 'twarda dyskwalifikacja strategiczna' };
  const ocenione = tak + nie;
  const udzialTak = ocenione ? tak / ocenione : 0;
  let werdykt = 'do decyzji';
  if (ocenione >= Math.ceil(pytania.length * 0.6) && udzialTak >= 0.7) werdykt = 'interesujący';
  else if (udzialTak < 0.4) werdykt = 'odpuszczony';
  return { werdykt, tak, nie, brak };
}

// Wspolne ID tematu: Inwestor_TypObiektu, unikalne, stabilne na cale zycie tematu
export function generujIdTematu(klientNazwa, coPowstaje, fallback) {
  const oczysc = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(sp\.?\s*z\s*o\.?\s*o\.?|s\.?a\.?|sp\.?j\.?|s\.?k\.?a\.?|z\.?o\.?o\.?)\b/gi, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 2).join('');
  const inwestor = oczysc(klientNazwa) || oczysc(fallback) || 'Temat';
  const typ = oczysc(coPowstaje) || 'inwestycja';
  const baza = `${inwestor}_${typ}`;
  let kandydat = baza, i = 2;
  const istnieje = (id) =>
    db.prepare('SELECT 1 FROM leady WHERE identyfikator = ?').get(id) ||
    db.prepare('SELECT 1 FROM tematy WHERE identyfikator = ?').get(id);
  while (istnieje(kandydat)) kandydat = `${baza}_${i++}`;
  return kandydat;
}
