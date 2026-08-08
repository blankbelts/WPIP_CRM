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

// ── Realizm czasowy ──────────────────────────────────────────────────────────
// prog_zastygniecia_dni to alarm ("nic sie nie dzieje"), czas_typowy_dni to norma
// ("tyle ten etap trwa, gdy idzie dobrze"). Dopiero druga liczba pozwala powiedziec,
// czy temat jest opozniony i kiedy realnie sie domknie.

const PROG_ZAGROZENIA = 0.8; // 80% normy = zolte swiatlo, jeszcze przed przekroczeniem

/** Stan czasowy tematu w biezacym etapie: w normie / zagrozony / opozniony. */
export function stanCzasu(temat) {
  const km = db.prepare('SELECT czas_typowy_dni FROM kamienie_karty WHERE id = ?').get(temat.kamien_id);
  const norma = km?.czas_typowy_dni || null;
  const dni = dniWEtapie(temat);
  if (!norma) return { dni, norma: null, stan: 'brak normy', przekroczenie: null };
  if (dni > norma) return { dni, norma, stan: 'opozniony', przekroczenie: dni - norma };
  if (dni >= norma * PROG_ZAGROZENIA) return { dni, norma, stan: 'zagrozony', przekroczenie: 0 };
  return { dni, norma, stan: 'w normie', przekroczenie: 0 };
}

/**
 * Prognoza podpisania: reszta normy biezacego etapu + normy wszystkich kolejnych.
 * Temat juz opozniony nie dostaje ujemnej reszty — liczymy od dzisiaj.
 */
export function prognozaPodpisania(temat) {
  const kamienie = kamienieKarty(temat.karta_id);
  const biezacy = kamienie.find(k => k.id === temat.kamien_id);
  if (!biezacy) return { data: null, dni: null, norma_calkowita: null };

  const { dni, norma } = stanCzasu(temat);
  const resztaBiezacego = norma ? Math.max(0, norma - dni) : 0;
  const kolejne = kamienie
    .filter(k => k.kolejnosc > biezacy.kolejnosc)
    .reduce((s, k) => s + (k.czas_typowy_dni || 0), 0);
  const doKonca = resztaBiezacego + kolejne;

  const data = new Date(Date.now() + doKonca * 86400000);
  return {
    data: data.toISOString().slice(0, 10),
    dni: doKonca,
    norma_calkowita: kamienie.reduce((s, k) => s + (k.czas_typowy_dni || 0), 0),
  };
}

// ── PDCA ─────────────────────────────────────────────────────────────────────
// Cztery fazy liczone z danych, ktore i tak powstaja w procesie:
//   PLAN  — zadania zaplanowane na biezacy kamien
//   DO    — ile z nich wykonano
//   CHECK — kryteria kamienia odhaczone vs brakujace + wyniki zadan + czas vs norma
//   ACT   — ostatnia decyzja korygujaca (albo jej brak, co samo w sobie jest sygnalem)

/** Pelny stan PDCA tematu na biezacym kamieniu. */
export function stanPdca(temat) {
  const kamien = db.prepare('SELECT * FROM kamienie_karty WHERE id = ?').get(temat.kamien_id);

  const kryteria = db.prepare(`SELECT kk.id, kk.tekst, kk.obowiazkowe,
      (SELECT 1 FROM kryteria_odhaczenia o WHERE o.kryterium_id = kk.id AND o.temat_id = ?) AS odhaczone
    FROM kamien_kryteria kk WHERE kk.kamien_id = ? AND kk.aktywny = 1 ORDER BY kk.kolejnosc`)
    .all(temat.id, temat.kamien_id);
  const spelnione = kryteria.filter(k => k.odhaczone).length;

  const zadania = db.prepare(`SELECT status, wynik FROM dzialania WHERE temat_id = ? AND kamien_id = ?`)
    .all(temat.id, temat.kamien_id);
  const wykonane = zadania.filter(z => z.status === 'wykonane');
  const osiagniete = wykonane.filter(z => z.wynik === 'Osiągnięty').length;
  const nieosiagniete = wykonane.filter(z => z.wynik === 'Nieosiągnięty').length;

  const ostatniaDecyzja = db.prepare(`SELECT * FROM pdca_decyzje WHERE temat_id = ?
    ORDER BY data DESC LIMIT 1`).get(temat.id);

  const czas = stanCzasu(temat);

  // Sygnal alarmowy: dwa nieosiagniete wyniki z rzedu bez decyzji korygujacej
  // znacza, ze powtarzamy to samo podejscie i liczymy na inny wynik.
  const wymagaDecyzji = nieosiagniete >= 2 &&
    (!ostatniaDecyzja || (wykonane.length && ostatniaDecyzja.kamien_id !== temat.kamien_id));

  return {
    kamien_kod: kamien?.kod || null,
    kamien_nazwa: kamien?.nazwa || null,
    plan: zadania.length,
    do: wykonane.length,
    check: {
      kryteria_spelnione: spelnione,
      kryteria_razem: kryteria.length,
      brakujace: kryteria.filter(k => !k.odhaczone).map(k => k.tekst),
      osiagniete, nieosiagniete,
      skutecznosc: wykonane.length ? Math.round(100 * osiagniete / wykonane.length) : null,
    },
    czas,
    act: ostatniaDecyzja || null,
    wymaga_decyzji: wymagaDecyzji,
    // Gotowosc kamienia: same kryteria decyduja o mozliwosci potwierdzenia
    gotowy: kryteria.length > 0 && kryteria.filter(k => k.obowiazkowe).every(k => k.odhaczone),
  };
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
