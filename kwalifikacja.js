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

// Auto-odpowiedzi na pytania kwalifikacji z danych leada (wybory scoringu + dyskwalifikacja).
// Dopasowanie po slowach kluczowych w tresci pytania - dziala dla domyslnych pytan,
// dla nietypowych/wlasnych zostawia "?" (handlowiec odpowie recznie).
export function autoOdpowiedzi(lead, wybory, pytania) {
  const A = wybory.A || '', B = wybory.B || '', C = wybory.C || '', E2 = wybory.E2 || '', F = wybory.F || '';
  const odp = {};
  for (const p of pytania) {
    const t = (p.tekst || '').toLowerCase();
    let a = '?';
    if (/dyskwalifikacj/.test(t)) a = lead.dyskwalifikacja_x ? 'nie' : 'tak';
    else if (/polska firma|klient końcow|operacyjn|deweloper spekul/.test(t))
      a = /polska firma/i.test(C) ? 'tak' : (/deweloper|publiczn|własnym gw|ctp/i.test(C) ? 'nie' : '?');
    else if (/produkcyjn|magazyn|segment/.test(t)) a = /produkcyjn|magazyn/i.test(A) ? 'tak' : (A ? 'nie' : '?');
    else if (/wartoś|zasięg|\bmln\b/.test(t)) a = /brak danych/i.test(B) ? '?' : (/poza przedział/i.test(B) ? 'nie' : 'tak');
    else if (/przewag|clean room|rozbudow|oze|referencj|instalacj/.test(t))
      a = (/rozbudow/i.test(F) || (E2 && !/inna|brak/i.test(E2))) ? 'tak' : '?';
    // "dobry powod kontaktu" i "wlasciwy moment" - brak danych na etapie importu => "?"
    odp[p.id] = a;
  }
  return odp;
}

// Sugestia procesu researchu na podstawie profilu (wybory C / E2)
export function autoProces(wybory) {
  const C = wybory.C || '', E2 = wybory.E2 || '';
  if (/deweloper/i.test(C)) return 'Deweloper magazynowy (trudny rynek)';
  if (/farmac|biotech/i.test(E2)) return 'Farmacja / biotech';
  return 'New Business — produkcja';
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
