// Silnik pipeline v2: potwierdzenia kamieni -> prawdopodobienstwo (ciagly prefiks),
// czas w etapie / zastygniecie, recykling. Awans TYLKO przez potwierdzenie z dowodem.
import { db } from './db.js';

// Kamienie karty tematu wg kolejnosci
function kamienieKarty(kartaId) {
  return db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(kartaId);
}

function potwierdzoneIds(tematId) {
  return new Set(db.prepare('SELECT DISTINCT kamien_id FROM potwierdzenia_kamieni WHERE temat_id = ?')
    .all(tematId).map(r => r.kamien_id));
}

// Przelicza stan tematu z potwierdzen: aktualny kamien = pierwszy niepotwierdzony,
// prawdopodobienstwo = prawd_start ostatniego kamienia z CIAGLEGO potwierdzonego prefiksu.
// Elastyczna kolejnosc M3<->M4: potwierdzenie M4 bez M3 nie rusza prefiksu (liczy najnizszy nieosiagniety).
export function przeliczTemat(tematId) {
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(tematId);
  if (!t) throw new Error('Nie znaleziono tematu');
  const kamienie = kamienieKarty(t.karta_id);
  if (!kamienie.length) return { kamien_id: t.kamien_id, prawdopodobienstwo: t.prawdopodobienstwo };
  const potw = potwierdzoneIds(tematId);

  // ciagly prefiks potwierdzonych od poczatku
  let osiagniety = null, pierwszyNiepotw = null;
  for (const km of kamienie) {
    if (potw.has(km.id)) osiagniety = km;
    else { pierwszyNiepotw = km; break; }
  }
  const wygrany = pierwszyNiepotw === null; // wszystko potwierdzone (z WYGRANA)
  const aktualny = pierwszyNiepotw || kamienie[kamienie.length - 1];
  // prawdopodobienstwo: ostatni osiagniety, a przed potwierdzeniem 1. kamienia - nominalne (polowa startu)
  const prawd = osiagniety ? osiagniety.prawd_start : Math.round(kamienie[0].prawd_start / 2);

  const zmianaKamienia = t.kamien_id !== aktualny.id;
  db.prepare('UPDATE tematy SET kamien_id = ?, prawdopodobienstwo = ?, korekta_reczna = 0 WHERE id = ?')
    .run(aktualny.id, wygrany ? 100 : prawd, tematId);
  if (zmianaKamienia) {
    db.prepare('INSERT INTO milestone_wejscia (temat_id, kamien_id) VALUES (?, ?)').run(tematId, aktualny.id);
  }
  if (wygrany && t.status === 'otwarty') {
    db.prepare(`UPDATE tematy SET status = 'wygrany' WHERE id = ?`).run(tematId);
  }
  return { kamien_id: aktualny.id, prawdopodobienstwo: wygrany ? 100 : prawd, osiagniety_kod: osiagniety?.kod || null, wygrany };
}

// Dni w biezacym etapie (od ostatniego wejscia w aktualny kamien)
export function dniWEtapie(temat) {
  const w = db.prepare(`SELECT data_wejscia FROM milestone_wejscia
    WHERE temat_id = ? AND kamien_id = ? ORDER BY data_wejscia DESC LIMIT 1`).get(temat.id, temat.kamien_id);
  const od = w ? new Date(w.data_wejscia + 'Z') : new Date(temat.utworzono + 'Z');
  return Math.floor((Date.now() - od.getTime()) / 86400000);
}

export function czyZastygly(temat) {
  const km = db.prepare('SELECT prog_zastygniecia_dni FROM kamienie_karty WHERE id = ?').get(temat.kamien_id);
  if (!km?.prog_zastygniecia_dni) return false;
  return dniWEtapie(temat) > km.prog_zastygniecia_dni && temat.status === 'otwarty';
}

// Reaktywacja tematow recyklingu, ktorych data powrotu nadeszla: wznow + zadanie follow-up
export function sprawdzRecykling() {
  const doWznowienia = db.prepare(`SELECT * FROM tematy WHERE status = 'recycled' AND recycle_date IS NOT NULL AND recycle_date <= date('now')`).all();
  for (const t of doWznowienia) {
    db.prepare(`UPDATE tematy SET status = 'otwarty', recycle_date = NULL WHERE id = ?`).run(t.id);
    db.prepare('INSERT INTO milestone_wejscia (temat_id, kamien_id) VALUES (?, ?)').run(t.id, t.kamien_id);
    db.prepare(`INSERT INTO dzialania (typ, cel, temat_id, klient_id, kamien_id, termin, status, notatki)
      VALUES ('telefon', ?, ?, ?, ?, date('now'), 'planowane', ?)`)
      .run('Follow-up po recyklingu — potwierdź czy sygnał wrócił', t.id, t.klient_id, t.kamien_id,
        'Temat wznowiony automatycznie z puli recyklingu');
    db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
      .run(t.id, 'recykling — wznowienie', 'recycled', 'otwarty', 'Data powrotu nadeszła; utworzono zadanie follow-up');
  }
  return doWznowienia.length;
}
