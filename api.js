// API WPIP CRM - wszystkie trasy REST
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, KOMPONENTY, NAZWY_KOMPONENTOW } from './db.js';
import { seedDemo } from './demo-seed.js';
import { parsujPlik, przygotujImport } from './import-ki.js';
import { parsujPipeline } from './import-pipeline.js';
import { policzScore, przeliczLeada, opcjeWersji, zamrozWersje, logujLeada } from './scoring.js';
import { werdyktKwalifikacji, generujIdTematu, autoOdpowiedzi, autoProces } from './kwalifikacja.js';
import { przeliczTemat, dniWEtapie, czyZastygly, sprawdzRecykling, stanCzasu, prognozaPodpisania, stanPdca } from './silnik-pipeline.js';
import { kartaDlaEtapu } from './seed-pipeline-v3.js';

export const api = Router();

const pick = (body, fields) => {
  const out = {};
  for (const f of fields) if (body[f] !== undefined) out[f] = body[f];
  return out;
};

function updateById(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...keys.map(k => data[k]), id);
}

// Regula 6: po wygranej utworz temat obserwacyjny F1-watch (przeglad konta za 6 mc)
function utworzF1Watch(zrodlo) {
  if (!zrodlo.klient_id) return null;
  const fast = db.prepare(`SELECT * FROM karty_ratingu WHERE kod = 'FAST_TRACK'`).get();
  if (!fast) return null;
  const f1 = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc LIMIT 1').get(fast.id);
  const klient = db.prepare('SELECT nazwa FROM klienci WHERE id = ?').get(zrodlo.klient_id);
  const id = generujIdTematu(klient?.nazwa, 'obserwacja', 'F1watch');
  const r = db.prepare(`INSERT INTO tematy
    (identyfikator, nazwa, klient_id, handlowiec, zrodlo, data_startu, marza_pct, karta_id, kamien_id, prawdopodobienstwo, status, czy_bierzemy)
    VALUES (?,?,?,?,?,date('now'),9,?,?,?, 'otwarty','obserwujemy')`)
    .run(id, 'F1-watch: przegląd konta po wygranej', zrodlo.klient_id, zrodlo.handlowiec,
      'F1-watch (po wygranej)', fast.id, f1.id, Math.round(f1.prawd_start / 2));
  const tematId = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO milestone_wejscia (temat_id, kamien_id) VALUES (?, ?)').run(tematId, f1.id);
  db.prepare(`INSERT INTO dzialania (typ, cel, temat_id, klient_id, kamien_id, termin, status, notatki)
    VALUES ('spotkanie', ?, ?, ?, ?, date('now','+6 months'), 'planowane', ?)`)
    .run('Przegląd konta — potwierdź sygnał rozwojowy (F1)', tematId, zrodlo.klient_id, f1.id,
      `Auto-utworzone po wygranej tematu ${zrodlo.identyfikator}`);
  // Konto staje sie powracajace z planem opieki
  db.prepare(`UPDATE klienci SET klient_powracajacy = 1,
    data_nastepnego_przegladu = COALESCE(data_nastepnego_przegladu, date('now','+6 months')) WHERE id = ?`).run(zrodlo.klient_id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_po, opis) VALUES (?,?,?,?)')
    .run(tematId, 'F1-watch', 'F1', `Utworzony po wygranej ${zrodlo.identyfikator}; przegląd konta za 6 mc`);
  return { id: tematId, identyfikator: id };
}

function kamienieProspectingu() {
  return db.prepare(`SELECT wartosc FROM slowniki WHERE typ = 'kamien_prospectingu' AND aktywny = 1 ORDER BY kolejnosc`)
    .all().map(r => r.wartosc);
}

// ---------- SLOWNIKI ----------
api.get('/slowniki', (req, res) => {
  const rows = db.prepare('SELECT * FROM slowniki WHERE aktywny = 1 ORDER BY typ, kolejnosc').all();
  const grouped = {};
  for (const r of rows) (grouped[r.typ] ||= []).push(r);
  res.json(grouped);
});
api.post('/slowniki', (req, res) => {
  const { typ, wartosc, delta = null, kolejnosc = 99 } = req.body;
  const r = db.prepare('INSERT INTO slowniki (typ, wartosc, delta, kolejnosc) VALUES (?,?,?,?)')
    .run(typ, wartosc, delta, kolejnosc);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/slowniki/:id', (req, res) => {
  updateById('slowniki', req.params.id, pick(req.body, ['wartosc', 'delta', 'kolejnosc', 'aktywny']));
  res.json({ ok: true });
});
api.delete('/slowniki/:id', (req, res) => {
  db.prepare('UPDATE slowniki SET aktywny = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- WERSJE SCORINGU (odpowiednik arkusza Parametry, wersjonowane) ----------
api.get('/wersje', (req, res) => {
  const wersje = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM grupy_leadow g WHERE g.wersja_id = w.id) AS liczba_grup,
      (SELECT COUNT(*) FROM leady l WHERE l.wersja_id = w.id) AS liczba_leadow
    FROM wersje_scoringu w ORDER BY w.id DESC`).all();
  for (const w of wersje) w.opcje = opcjeWersji(w.id);
  res.json({ wersje, komponenty: KOMPONENTY, nazwy_komponentow: NAZWY_KOMPONENTOW });
});

// Nowa wersja = duplikat zrodlowej (opcje + progi) w statusie robocza
api.post('/wersje', (req, res) => {
  const { nazwa, opis = '', zrodlo_id } = req.body;
  if (!nazwa) return res.status(400).json({ error: 'Nazwa wersji jest wymagana' });
  const zrodlo = zrodlo_id ? db.prepare('SELECT * FROM wersje_scoringu WHERE id = ?').get(zrodlo_id) : null;
  const r = db.prepare(`INSERT INTO wersje_scoringu (nazwa, opis, status, prog_a, prog_b, prog_c) VALUES (?,?,'robocza',?,?,?)`)
    .run(nazwa, opis, zrodlo?.prog_a ?? 85, zrodlo?.prog_b ?? 70, zrodlo?.prog_c ?? 55);
  const nowaId = Number(r.lastInsertRowid);
  if (zrodlo) {
    const opcje = db.prepare('SELECT * FROM wersja_opcje WHERE wersja_id = ?').all(zrodlo.id);
    const ins = db.prepare('INSERT INTO wersja_opcje (wersja_id, komponent, etykieta, punkty, dyskwalifikacja, kolejnosc) VALUES (?,?,?,?,?,?)');
    for (const o of opcje) ins.run(nowaId, o.komponent, o.etykieta, o.punkty, o.dyskwalifikacja, o.kolejnosc);
  }
  res.json({ id: nowaId });
});

function wymagajRobocza(wersjaId, res) {
  const w = db.prepare('SELECT * FROM wersje_scoringu WHERE id = ?').get(wersjaId);
  if (!w) { res.status(404).json({ error: 'Nie znaleziono wersji' }); return null; }
  if (w.status !== 'robocza') {
    res.status(400).json({ error: `Wersja "${w.nazwa}" jest ${w.status} — użyta do przeliczeń, nie można jej edytować. Zduplikuj ją, aby zmienić parametry.` });
    return null;
  }
  return w;
}

api.put('/wersje/:id', (req, res) => {
  if (!wymagajRobocza(req.params.id, res)) return;
  updateById('wersje_scoringu', req.params.id, pick(req.body, ['nazwa', 'opis', 'prog_a', 'prog_b', 'prog_c']));
  res.json({ ok: true });
});
api.post('/wersje/:id/opcje', (req, res) => {
  if (!wymagajRobocza(req.params.id, res)) return;
  const { komponent, etykieta, punkty, dyskwalifikacja = 0 } = req.body;
  const r = db.prepare('INSERT INTO wersja_opcje (wersja_id, komponent, etykieta, punkty, dyskwalifikacja, kolejnosc) VALUES (?,?,?,?,?,99)')
    .run(req.params.id, komponent, etykieta, punkty, dyskwalifikacja);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/wersje-opcje/:id', (req, res) => {
  const opcja = db.prepare('SELECT * FROM wersja_opcje WHERE id = ?').get(req.params.id);
  if (!opcja) return res.status(404).json({ error: 'Nie znaleziono opcji' });
  if (!wymagajRobocza(opcja.wersja_id, res)) return;
  updateById('wersja_opcje', req.params.id, pick(req.body, ['etykieta', 'punkty', 'dyskwalifikacja', 'kolejnosc']));
  res.json({ ok: true });
});
api.delete('/wersje-opcje/:id', (req, res) => {
  const opcja = db.prepare('SELECT * FROM wersja_opcje WHERE id = ?').get(req.params.id);
  if (!opcja) return res.status(404).json({ error: 'Nie znaleziono opcji' });
  if (!wymagajRobocza(opcja.wersja_id, res)) return;
  db.prepare('DELETE FROM wersja_opcje WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- GRUPY LEADOW (jedna zaladowana baza = jedna grupa) ----------
api.get('/grupy', (req, res) => {
  const grupy = db.prepare(`
    SELECT g.*, w.nazwa AS wersja_nazwa, w.status AS wersja_status,
      (SELECT COUNT(*) FROM leady l WHERE l.grupa_id = g.id) AS liczba_leadow,
      (SELECT COUNT(*) FROM lead_wystapienia lw WHERE lw.grupa_id = g.id) AS liczba_wystapien
    FROM grupy_leadow g LEFT JOIN wersje_scoringu w ON w.id = g.wersja_id
    ORDER BY g.id DESC`).all();
  for (const g of grupy) {
    g.priorytety = Object.fromEntries(
      db.prepare(`SELECT priorytet, COUNT(*) c FROM leady WHERE grupa_id = ? GROUP BY priorytet`).all(g.id)
        .map(r => [r.priorytet, r.c]));
  }
  res.json(grupy);
});
api.post('/grupy', (req, res) => {
  const { nazwa, opis = '', zrodlo = null, wersja_id } = req.body;
  if (!nazwa) return res.status(400).json({ error: 'Nazwa grupy jest wymagana' });
  if (!wersja_id) return res.status(400).json({ error: 'Grupa musi mieć przypisaną wersję scoringu' });
  const r = db.prepare('INSERT INTO grupy_leadow (nazwa, opis, zrodlo, wersja_id) VALUES (?,?,?,?)')
    .run(nazwa, opis, zrodlo, wersja_id);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/grupy/:id', (req, res) => {
  updateById('grupy_leadow', req.params.id, pick(req.body, ['nazwa', 'opis', 'wersja_id']));
  res.json({ ok: true });
});

// Przeliczenie calej grupy wersja przypisana do grupy (zamraza wersje)
api.post('/grupy/:id/przelicz', (req, res) => {
  const grupa = db.prepare('SELECT * FROM grupy_leadow WHERE id = ?').get(req.params.id);
  if (!grupa) return res.status(404).json({ error: 'Nie znaleziono grupy' });
  if (req.body.wersja_id) {
    db.prepare('UPDATE grupy_leadow SET wersja_id = ? WHERE id = ?').run(req.body.wersja_id, grupa.id);
    grupa.wersja_id = req.body.wersja_id;
  }
  if (!grupa.wersja_id) return res.status(400).json({ error: 'Grupa nie ma przypisanej wersji scoringu' });

  const leady = db.prepare('SELECT id, priorytet FROM leady WHERE grupa_id = ?').all(grupa.id);
  const wersja = db.prepare('SELECT nazwa FROM wersje_scoringu WHERE id = ?').get(grupa.wersja_id);
  let zmianyPriorytetu = 0;
  db.exec('BEGIN');
  try {
    for (const l of leady) {
      const wynik = przeliczLeada(l.id, grupa.wersja_id, `Przeliczenie grupy "${grupa.nazwa}" wersją "${wersja.nazwa}"`);
      if (wynik.priorytet !== l.priorytet) zmianyPriorytetu++;
    }
    zamrozWersje(grupa.wersja_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ przeliczono: leady.length, zmiany_priorytetu: zmianyPriorytetu });
});

// ---------- KLIENCI ----------
const KLIENT_POLA = ['nazwa', 'nip', 'zrodlo_pozyskania', 'klient_powracajacy', 'opiekun', 'branza',
  'miasto', 'wojewodztwo', 'potencjal_oze', 'dyskwalifikacja', 'powod_dyskwalifikacji', 'notatki',
  'data_nastepnego_przegladu'];

api.get('/klienci', (req, res) => {
  res.json(db.prepare(`
    SELECT k.*,
      (SELECT COUNT(*) FROM tematy t WHERE t.klient_id = k.id) AS liczba_tematow,
      (SELECT COUNT(*) FROM leady l WHERE l.klient_id = k.id) AS liczba_leadow
    FROM klienci k ORDER BY k.nazwa`).all());
});
api.get('/klienci/:id', (req, res) => {
  const k = db.prepare('SELECT * FROM klienci WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  k.osoby = db.prepare('SELECT * FROM osoby WHERE klient_id = ?').all(k.id);
  k.tematy = db.prepare('SELECT * FROM tematy WHERE klient_id = ? ORDER BY utworzono DESC').all(k.id);
  k.leady = db.prepare('SELECT * FROM leady WHERE klient_id = ? ORDER BY utworzono DESC').all(k.id);
  k.dzialania = db.prepare('SELECT * FROM dzialania WHERE klient_id = ? ORDER BY termin DESC').all(k.id);
  res.json(k);
});
api.post('/klienci', (req, res) => {
  const d = pick(req.body, KLIENT_POLA);
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO klienci (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => d[k]));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/klienci/:id', (req, res) => {
  updateById('klienci', req.params.id, pick(req.body, KLIENT_POLA));
  res.json({ ok: true });
});

// ---------- OSOBY KONTAKTOWE ----------
const OSOBA_POLA = ['klient_id', 'imie_nazwisko', 'stanowisko', 'email', 'telefon', 'rola_w_decyzji', 'notatki'];
api.get('/osoby', (req, res) => {
  res.json(db.prepare(`SELECT o.*, k.nazwa AS klient_nazwa FROM osoby o
    LEFT JOIN klienci k ON k.id = o.klient_id ORDER BY o.imie_nazwisko`).all());
});
api.post('/osoby', (req, res) => {
  const d = pick(req.body, OSOBA_POLA);
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO osoby (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => d[k]));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/osoby/:id', (req, res) => {
  updateById('osoby', req.params.id, pick(req.body, OSOBA_POLA));
  res.json({ ok: true });
});

// ---------- LEADY (prospecting - sciezka pozyskania tematu) ----------
const LEAD_POLA = ['nazwa', 'klient_id', 'inwestycja_id', 'osoba_id', 'handlowiec', 'zrodlo',
  'prawd_kwalifikacji', 'pwe', 'dobry_powod_kontaktu', 'notatki',
  'sposob_pozyskania', 'zrodlo_wiedzy_wpip', 'proces_researchu', 'identyfikator', 'kampania_id'];

api.get('/leady', (req, res) => {
  const { grupa } = req.query;
  let sql = `
    SELECT l.*, k.nazwa AS klient_nazwa, i.nazwa AS inwestycja_nazwa, i.wojewodztwo,
      g.nazwa AS grupa_nazwa, w.nazwa AS wersja_nazwa,
      (SELECT COUNT(*) FROM dzialania d WHERE d.lead_id = l.id AND d.status = 'planowane') AS dzialania_otwarte,
      (SELECT COUNT(*) FROM lead_wystapienia lw WHERE lw.lead_id = l.id) AS liczba_wystapien
    FROM leady l
    LEFT JOIN klienci k ON k.id = l.klient_id
    LEFT JOIN inwestycje i ON i.id = l.inwestycja_id
    LEFT JOIN grupy_leadow g ON g.id = l.grupa_id
    LEFT JOIN wersje_scoringu w ON w.id = l.wersja_id`;
  const params = [];
  if (grupa) { sql += ' WHERE l.grupa_id = ?'; params.push(grupa); }
  sql += ' ORDER BY l.score_total DESC, l.utworzono DESC';
  res.json(db.prepare(sql).all(...params));
});

api.get('/leady/:id', (req, res) => {
  const l = db.prepare(`SELECT l.*, k.nazwa AS klient_nazwa, i.nazwa AS inwestycja_nazwa,
      i.etap_projektu, i.wartosc_inwestycji, i.wojewodztwo, i.miasto AS inwestycja_miasto,
      o.imie_nazwisko AS osoba_nazwa, g.nazwa AS grupa_nazwa, w.nazwa AS wersja_nazwa,
      w.prog_a, w.prog_b, w.prog_c
    FROM leady l LEFT JOIN klienci k ON k.id = l.klient_id
    LEFT JOIN inwestycje i ON i.id = l.inwestycja_id
    LEFT JOIN osoby o ON o.id = l.osoba_id
    LEFT JOIN grupy_leadow g ON g.id = l.grupa_id
    LEFT JOIN wersje_scoringu w ON w.id = l.wersja_id
    WHERE l.id = ?`).get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Nie znaleziono leada' });
  l.wybory = JSON.parse(l.wybory || '{}');
  l.opcje_wersji = l.wersja_id ? opcjeWersji(l.wersja_id) : {};
  l.dzialania = db.prepare('SELECT * FROM dzialania WHERE lead_id = ? ORDER BY termin').all(l.id);
  l.decyzje = db.prepare('SELECT * FROM decyzje_komitetu WHERE lead_id = ? ORDER BY data DESC').all(l.id);
  l.historia = db.prepare('SELECT * FROM historia_leada WHERE lead_id = ? ORDER BY data DESC').all(l.id);
  l.wystapienia = db.prepare(`SELECT lw.*, g.nazwa AS grupa_nazwa FROM lead_wystapienia lw
    LEFT JOIN grupy_leadow g ON g.id = lw.grupa_id WHERE lw.lead_id = ? ORDER BY lw.data`).all(l.id);
  l.kamienie = kamienieProspectingu();
  l.kwalif_odpowiedzi = JSON.parse(l.kwalif_odpowiedzi || '{}');
  l.pytania_kwalifikacji = db.prepare('SELECT * FROM pytania_kwalifikacji WHERE aktywny = 1 ORDER BY kolejnosc').all();
  res.json(l);
});

// Reczne dodanie leada do grupy (z wyborami komponentow)
api.post('/leady', (req, res) => {
  const d = pick(req.body, LEAD_POLA);
  const { grupa_id, wybory = {} } = req.body;
  if (!d.nazwa) return res.status(400).json({ error: 'Nazwa leada jest wymagana' });
  if (!grupa_id) return res.status(400).json({ error: 'Lead musi należeć do grupy' });
  const grupa = db.prepare('SELECT * FROM grupy_leadow WHERE id = ?').get(grupa_id);
  if (!grupa?.wersja_id) return res.status(400).json({ error: 'Grupa nie ma przypisanej wersji scoringu' });

  // Wspolne ID tematu generowane juz na leadzie (przekazywane pozniej do ZOS)
  if (!d.identyfikator) {
    const klient = d.klient_id ? db.prepare('SELECT nazwa FROM klienci WHERE id = ?').get(d.klient_id) : null;
    d.identyfikator = generujIdTematu(klient?.nazwa, wybory.A, d.nazwa);
  }
  const wynik = policzScore(wybory, grupa.wersja_id);
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO leady (${keys.join(',')}, grupa_id, wersja_id, wybory, score_total, priorytet, dyskwalifikacja_x, dyskwalifikacja_powod)
    VALUES (${keys.map(() => '?').join(',')},?,?,?,?,?,?,?)`)
    .run(...keys.map(k => d[k]), grupa_id, grupa.wersja_id, JSON.stringify(wybory),
      wynik.total, wynik.priorytet, wynik.dyskwalifikacja, wynik.powod);
  const id = Number(r.lastInsertRowid);
  logujLeada(id, 'utworzenie', null, `${wynik.total} / ${wynik.priorytet}`, `Dodany ręcznie do grupy "${grupa.nazwa}" · ID ${d.identyfikator}`);
  zamrozWersje(grupa.wersja_id);
  res.json({ id, score_total: wynik.total, priorytet: wynik.priorytet });
});

api.put('/leady/:id', (req, res) => {
  updateById('leady', req.params.id, pick(req.body, LEAD_POLA));
  res.json({ ok: true });
});

// Zmiana wyboru komponentu (reklasyfikacja, np. Futureal: polska firma -> deweloper) -> auto-przeliczenie
api.post('/leady/:id/wybory', (req, res) => {
  const { komponent, etykieta } = req.body;
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  if (!lead.wersja_id) return res.status(400).json({ error: 'Lead nie ma wersji scoringu (przypisz grupę do wersji i przelicz)' });
  if (!KOMPONENTY.includes(komponent)) return res.status(400).json({ error: 'Nieznany komponent' });
  const opcja = db.prepare('SELECT * FROM wersja_opcje WHERE wersja_id = ? AND komponent = ? AND etykieta = ?')
    .get(lead.wersja_id, komponent, etykieta);
  if (!opcja) return res.status(400).json({ error: `Opcja "${etykieta}" nie istnieje w komponencie ${komponent} tej wersji` });

  const wybory = JSON.parse(lead.wybory || '{}');
  const przed = wybory[komponent] || '—';
  wybory[komponent] = etykieta;
  db.prepare('UPDATE leady SET wybory = ? WHERE id = ?').run(JSON.stringify(wybory), lead.id);
  logujLeada(lead.id, 'reklasyfikacja', `${komponent}: ${przed}`, `${komponent}: ${etykieta}`, 'Zmiana ręczna');
  const wynik = przeliczLeada(lead.id, lead.wersja_id, `Reklasyfikacja ${komponent}`);
  res.json({ ok: true, score_total: wynik.total, priorytet: wynik.priorytet });
});

// Status researchu: SZARY / ZIELONY / ZOLTY (notatka obowiazkowa) / CZERWONY (sugeruje odpuszczenie)
api.post('/leady/:id/research', (req, res) => {
  const { status, notatka } = req.body;
  if (!['SZARY', 'ZIELONY', 'ŻÓŁTY', 'CZERWONY'].includes(status)) {
    return res.status(400).json({ error: 'Nieznany status researchu' });
  }
  if (status === 'ŻÓŁTY' && !notatka) {
    return res.status(400).json({ error: 'Status ŻÓŁTY wymaga notatki z czynnikiem ryzyka (np. „stały GW Takenaka", „PKD 41.20.Z w grupie")' });
  }
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  db.prepare('UPDATE leady SET status_researchu = ?, research_notatka = COALESCE(?, research_notatka) WHERE id = ?')
    .run(status, notatka || null, lead.id);
  logujLeada(lead.id, 'research', lead.status_researchu, status, notatka || null);
  res.json({ ok: true });
});

// Przejscie kamienia sciezki = decyzja handlowca. Bramki (fast_track omija bramki procesowe):
//  - za "Kwalifikacja wstepna": wymagany werdykt "interesujacy" + przypisany proces researchu
//  - za "Research": research ZIELONY/ZOLTY dla priorytetu A; CZERWONY blokuje zawsze
//  - do "Zakwalifikowany": scoring A-F potwierdzony po researchu
api.post('/leady/:id/kamien', (req, res) => {
  const { kamien } = req.body;
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  if (lead.status !== 'aktywny') return res.status(400).json({ error: `Lead ma status "${lead.status}" — przywróć go do aktywnych, aby prowadzić po ścieżce` });
  const kamienie = kamienieProspectingu();
  const idxCel = kamienie.indexOf(kamien);
  if (idxCel < 0) return res.status(400).json({ error: 'Nieznany kamień ścieżki' });
  const idx = (n) => kamienie.indexOf(n);
  const ft = lead.fast_track;

  // Bramka kwalifikacji wstepnej
  if (idxCel > idx('Kwalifikacja wstępna') && !ft) {
    if (lead.kwalif_wynik !== 'interesujący') {
      return res.status(400).json({ error: 'Najpierw zakończ kwalifikację wstępną z werdyktem „interesujący" (albo oznacz lead jako fast-track / wyjątek od bramki)' });
    }
    if (!lead.proces_researchu) {
      return res.status(400).json({ error: 'Przypisz proces researchu w kwalifikacji wstępnej przed przejściem dalej' });
    }
  }
  // Bramka researchu
  if (idxCel > idx('Research')) {
    if (lead.status_researchu === 'CZERWONY') {
      return res.status(400).json({ error: 'Research CZERWONY — lead powinien zostać odpuszczony, nie prowadzony dalej' });
    }
    if (!ft && lead.priorytet === 'A' && !['ZIELONY', 'ŻÓŁTY'].includes(lead.status_researchu)) {
      return res.status(400).json({ error: 'Lead priorytetu A wymaga researchu (ZIELONY lub ŻÓŁTY) przed przejściem dalej' });
    }
  }
  // Bramka finalnej oceny — scoring potwierdzony po researchu
  if (kamien === 'Zakwalifikowany' && !ft && !lead.scoring_potwierdzony) {
    return res.status(400).json({ error: 'Przed kwalifikacją do Komitetu potwierdź scoring A–F po researchu (sekcja „Scoring")' });
  }
  db.prepare('UPDATE leady SET kamien = ? WHERE id = ?').run(kamien, lead.id);
  logujLeada(lead.id, 'kamień ścieżki', lead.kamien, kamien, ft ? 'Fast-track (wyjątek od bramki)' : 'Decyzja handlowca');
  res.json({ ok: true });
});

// Kwalifikacja wstepna: zapis odpowiedzi + werdykt + przypisanie procesu researchu
api.post('/leady/:id/kwalifikacja', (req, res) => {
  const { odpowiedzi = {}, wynik, proces_researchu } = req.body;
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  if (wynik && !['interesujący', 'do decyzji', 'odpuszczony'].includes(wynik)) {
    return res.status(400).json({ error: 'Nieznany werdykt kwalifikacji' });
  }
  const sugestia = werdyktKwalifikacji(odpowiedzi);
  const finalny = wynik || sugestia.werdykt;
  db.prepare('UPDATE leady SET kwalif_odpowiedzi = ?, kwalif_wynik = ?, proces_researchu = COALESCE(?, proces_researchu) WHERE id = ?')
    .run(JSON.stringify(odpowiedzi), finalny, proces_researchu || null, lead.id);
  logujLeada(lead.id, 'kwalifikacja wstępna', lead.kwalif_wynik, finalny,
    `${sugestia.tak}× tak / ${sugestia.nie}× nie` + (proces_researchu ? ` · proces: ${proces_researchu}` : ''));

  // Werdykt "interesujacy" na etapie "Lead surowy" -> przesun na "Kwalifikacja wstepna"
  if (lead.kamien === 'Lead surowy') {
    db.prepare(`UPDATE leady SET kamien = 'Kwalifikacja wstępna' WHERE id = ?`).run(lead.id);
  }
  // Werdykt "odpuszczony" -> zamkniecie leada z powodem (przedkomitetowe)
  if (finalny === 'odpuszczony') {
    db.prepare(`UPDATE leady SET status = 'odpuszczony', powod_odpuszczenia = 'Kwalifikacja wstępna negatywna' WHERE id = ?`).run(lead.id);
    logujLeada(lead.id, 'status', 'aktywny', 'odpuszczony', 'Zamknięty przedkomitetowo — kwalifikacja wstępna negatywna');
  }
  res.json({ ok: true, werdykt: finalny, sugestia: sugestia.werdykt });
});

// Masowa wstepna kwalifikacja: auto-triage leadow "Lead surowy" na podstawie danych z importu.
// Werdykt sugerowany + proces researchu; handlowiec moze pozniej skorygowac na leadzie.
api.post('/leady/kwalifikuj-wstepnie', (req, res) => {
  const { grupa_id, tylko_bez_werdyktu = true } = req.body;
  const pytania = db.prepare('SELECT * FROM pytania_kwalifikacji WHERE aktywny = 1').all();
  let sql = `SELECT * FROM leady WHERE status = 'aktywny' AND kamien = 'Lead surowy'`;
  const params = [];
  if (grupa_id) { sql += ' AND grupa_id = ?'; params.push(grupa_id); }
  if (tylko_bez_werdyktu) sql += ' AND (kwalif_wynik IS NULL OR kwalif_wynik = \'\')';
  const leady = db.prepare(sql).all(...params);

  const stat = { przetworzone: 0, interesujace: 0, do_decyzji: 0, odpuszczone: 0 };
  db.exec('BEGIN');
  try {
    for (const lead of leady) {
      let wybory = {};
      try { wybory = JSON.parse(lead.wybory || '{}'); } catch {}
      const odp = autoOdpowiedzi(lead, wybory, pytania);
      const w = werdyktKwalifikacji(odp);
      const proces = autoProces(wybory);
      db.prepare('UPDATE leady SET kwalif_odpowiedzi = ?, kwalif_wynik = ?, proces_researchu = COALESCE(proces_researchu, ?) WHERE id = ?')
        .run(JSON.stringify(odp), w.werdykt, proces, lead.id);
      if (w.werdykt === 'odpuszczony') {
        db.prepare(`UPDATE leady SET status = 'odpuszczony', powod_odpuszczenia = 'Kwalifikacja wstępna negatywna' WHERE id = ?`).run(lead.id);
        stat.odpuszczone++;
      } else {
        db.prepare(`UPDATE leady SET kamien = 'Kwalifikacja wstępna' WHERE id = ?`).run(lead.id);
        if (w.werdykt === 'interesujący') stat.interesujace++; else stat.do_decyzji++;
      }
      logujLeada(lead.id, 'kwalifikacja wstępna (auto)', 'Lead surowy', w.werdykt,
        `${w.tak}× tak / ${w.nie}× nie · proces: ${proces}`);
      stat.przetworzone++;
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  res.json(stat);
});

// Fast-track: wyjatek od bramki scoringowej (np. temat od Zarzadu ponizej progu)
api.post('/leady/:id/fast-track', (req, res) => {
  const { powod } = req.body;
  if (!powod) return res.status(400).json({ error: 'Fast-track wymaga uzasadnienia (kto i dlaczego eskaluje)' });
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  db.prepare('UPDATE leady SET fast_track = 1, fast_track_powod = ? WHERE id = ?').run(powod, lead.id);
  logujLeada(lead.id, 'fast-track', '0', '1', powod);
  res.json({ ok: true });
});

// Potwierdzenie scoringu A-F po researchu (warunek wejscia na "Zakwalifikowany")
api.post('/leady/:id/potwierdz-scoring', (req, res) => {
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  const nowa = lead.scoring_potwierdzony ? 0 : 1;
  db.prepare('UPDATE leady SET scoring_potwierdzony = ? WHERE id = ?').run(nowa, lead.id);
  logujLeada(lead.id, 'scoring potwierdzony', String(lead.scoring_potwierdzony), String(nowa),
    nowa ? 'Scoring A–F potwierdzony po researchu' : 'Cofnięto potwierdzenie scoringu');
  res.json({ ok: true, scoring_potwierdzony: nowa });
});

// Pakiet handoff ZOS (krok 2 E2E) - komplet danych do przekazania do rejestru / Intense
api.get('/leady/:id/zos', (req, res) => {
  const l = db.prepare(`SELECT l.*, k.nazwa AS klient_nazwa, k.nip, k.branza AS klient_branza,
      i.nazwa AS inwestycja_nazwa, i.wojewodztwo, i.miasto AS inwestycja_miasto, i.wartosc_inwestycji, i.etap_projektu,
      o.imie_nazwisko AS osoba_nazwa, o.stanowisko, o.email, o.telefon
    FROM leady l LEFT JOIN klienci k ON k.id = l.klient_id
    LEFT JOIN inwestycje i ON i.id = l.inwestycja_id
    LEFT JOIN osoby o ON o.id = l.osoba_id WHERE l.id = ?`).get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Nie znaleziono leada' });
  res.json({
    id_tematu: l.identyfikator,
    kontrahent: l.klient_nazwa, nip: l.nip, branza: l.klient_branza,
    opiekun: l.handlowiec,
    sposob_pozyskania: l.sposob_pozyskania,
    zrodlo_wiedzy_wpip: l.zrodlo_wiedzy_wpip,
    proces_researchu: l.proces_researchu,
    inwestycja: l.inwestycja_nazwa, lokalizacja: [l.inwestycja_miasto, l.wojewodztwo].filter(Boolean).join(', '),
    wartosc_inwestycji: l.wartosc_inwestycji, etap: l.etap_projektu,
    osoba_decyzyjna: l.osoba_nazwa, stanowisko: l.stanowisko, email: l.email, telefon: l.telefon,
    scoring: `${l.score_total} pkt (priorytet ${l.priorytet})`,
    kwalifikacja_wstepna: l.kwalif_wynik,
    status_researchu: l.status_researchu,
  });
});

// Wyjscia boczne sciezki: odpuszczony (powod obowiazkowy) / uspiony (nurture) / aktywny (powrot)
api.post('/leady/:id/status', (req, res) => {
  const { status, powod } = req.body;
  if (!['aktywny', 'uspiony', 'odpuszczony'].includes(status)) {
    return res.status(400).json({ error: 'Nieznany status' });
  }
  if (status === 'odpuszczony' && !powod) {
    return res.status(400).json({ error: 'Odpuszczenie wymaga powodu (słownik powodów odpuszczenia)' });
  }
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  db.prepare('UPDATE leady SET status = ?, powod_odpuszczenia = ? WHERE id = ?')
    .run(status, status === 'odpuszczony' ? powod : null, lead.id);
  logujLeada(lead.id, 'status', lead.status, status, powod || null);
  res.json({ ok: true });
});

// Uruchomienie tematu z leada na M1 pipeline persony (lead = top lejka, temat od M1)
api.post('/leady/:id/uruchom-temat', (req, res) => {
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  if (lead.temat_id) return res.status(400).json({ error: 'Lead ma już powiązany temat' });

  // Ścieżka procesu: klient powracający → FAST-TRACK, w pozostałych przypadkach
  // decyduje etap projektu inwestora (gotowy projekt = ~6 mc, koncepcja = 12–18 mc).
  // Etap bierzemy z inwestycji, a gdy jej brak — z komponentu D scoringu leada,
  // który używa tych samych etykiet. Handlowiec może nadpisać przez pipeline_kod.
  const kod = req.body.pipeline_kod;
  let karta;
  if (kod) {
    karta = db.prepare('SELECT * FROM karty_ratingu WHERE kod = ?').get(kod);
    if (!karta) return res.status(400).json({ error: 'Nie znaleziono ścieżki procesu: ' + kod });
  } else {
    const inw = lead.inwestycja_id
      ? db.prepare('SELECT etap_projektu FROM inwestycje WHERE id = ?').get(lead.inwestycja_id) : null;
    let etap = inw?.etap_projektu;
    if (!etap) { try { etap = JSON.parse(lead.wybory || '{}').D; } catch { /* wybory bez D */ } }
    const powracajacy = /powracaj/i.test(lead.proces_researchu || '')
      || !!(lead.klient_id && db.prepare('SELECT klient_powracajacy p FROM klienci WHERE id = ?').get(lead.klient_id)?.p);
    karta = kartaDlaEtapu(db, etap, powracajacy);
    if (!karta) return res.status(400).json({ error: 'Brak aktywnej ścieżki procesu' });
  }
  const m1 = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc LIMIT 1').get(karta.id);

  let identyfikator = lead.identyfikator;
  if (!identyfikator || db.prepare('SELECT 1 FROM tematy WHERE identyfikator = ?').get(identyfikator)) {
    const klient = lead.klient_id ? db.prepare('SELECT nazwa FROM klienci WHERE id = ?').get(lead.klient_id) : null;
    identyfikator = generujIdTematu(klient?.nazwa, null, lead.nazwa);
  }

  const r = db.prepare(`INSERT INTO tematy
    (identyfikator, nazwa, klient_id, inwestycja_id, osoba_id, handlowiec, zrodlo, model_realizacji,
     data_startu, marza_pct, karta_id, kamien_id, prawdopodobienstwo, status, czy_bierzemy, lead_id)
    VALUES (?,?,?,?,?,?,?,?,date('now'),9,?,?,?, 'otwarty','ofertujemy',?)`)
    .run(identyfikator, lead.nazwa, lead.klient_id, lead.inwestycja_id, lead.osoba_id, lead.handlowiec,
      lead.zrodlo, 'Generalne wykonawstwo', karta.id, m1.id, Math.round(m1.prawd_start / 2), lead.id);
  const tematId = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO milestone_wejscia (temat_id, kamien_id) VALUES (?, ?)').run(tematId, m1.id);
  db.prepare('UPDATE leady SET temat_id = ?, status = ? WHERE id = ?').run(tematId, 'przekazany do pipeline', lead.id);
  logujLeada(lead.id, 'uruchomienie tematu', lead.kamien, 'pipeline: ' + karta.nazwa, `Temat ${identyfikator} na kamieniu ${m1.kod}`);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_po, opis) VALUES (?,?,?,?)')
    .run(tematId, 'utworzenie', `${m1.kod} ${m1.nazwa}`, `Uruchomiony z leada "${lead.nazwa}" · pipeline ${karta.nazwa}`);
  res.json({ id: tematId, identyfikator, pipeline: karta.nazwa });
});

// ---------- KOMITET OFERTOWY (kamien M5/F3 wewnatrz tematu) ----------
// Kolejka = tematy na kamieniu M5 (STANDARD) / F3 (FAST-TRACK) czekajace na decyzje BID/NO-BID.
// BID = potwierdzenie kamienia M5/F3 (przez /tematy/:id/potwierdz-kamien).
// NO-BID = zamkniecie tematu z powodem (przez /tematy/:id/zamknij).
api.get('/komitet/kolejka', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*, k.nazwa AS klient_nazwa, km.kod AS kamien_kod, km.id AS akt_kamien_id,
      km.definicja_spelnienia, kr.kod AS pipeline_kod, i.wartosc_inwestycji
    FROM tematy t
    LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    LEFT JOIN inwestycje i ON i.id = t.inwestycja_id
    WHERE t.status = 'otwarty' AND km.kod IN ('M5', 'F3', 'P5', 'K8')
    ORDER BY t.wartosc_kontraktu DESC`).all());
});
api.get('/komitet/decyzje', (req, res) => {
  res.json(db.prepare(`
    SELECT dk.*, l.nazwa AS lead_nazwa, t.identyfikator AS temat_identyfikator
    FROM decyzje_komitetu dk
    LEFT JOIN leady l ON l.id = dk.lead_id
    LEFT JOIN tematy t ON t.id = dk.temat_id
    ORDER BY dk.data DESC`).all());
});

api.post('/komitet/decyzja', (req, res) => {
  const { lead_id, decyzja, powod, uzasadnienie, temat } = req.body;
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(lead_id);
  if (!lead) return res.status(404).json({ error: 'Nie znaleziono leada' });
  if (!['bid', 'no_bid', 'defer'].includes(decyzja)) return res.status(400).json({ error: 'Nieznana decyzja' });
  if (decyzja !== 'bid' && !powod) return res.status(400).json({ error: 'Powod jest obowiazkowy dla no bid / defer' });

  let tematId = null;
  if (decyzja === 'bid') {
    // Domyslnie dziedziczymy wspolne ID nadane juz na leadzie (jedno ID na cale zycie tematu)
    if (temat && !temat.identyfikator) temat.identyfikator = lead.identyfikator;
    if (!temat?.identyfikator) return res.status(400).json({ error: 'Identyfikator tematu (Inwestor_TypInwestycji) jest wymagany' });
    const karta = temat.karta_id
      ? db.prepare('SELECT * FROM karty_ratingu WHERE id = ?').get(temat.karta_id)
      : db.prepare('SELECT * FROM karty_ratingu WHERE aktywna = 1 ORDER BY id LIMIT 1').get();
    const kamien = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc LIMIT 1').get(karta.id);
    const r = db.prepare(`INSERT INTO tematy
      (identyfikator, nazwa, klient_id, inwestycja_id, osoba_id, handlowiec, zrodlo, model_realizacji,
       co_budujemy, data_startu, wartosc_kontraktu, marza_pct, termin_oferty, termin_realizacji,
       czas_trwania_mies, karta_id, kamien_id, prawdopodobienstwo, czy_bierzemy)
      VALUES (?,?,?,?,?,?,?,?,?,date('now'),?,?,?,?,?,?,?,?,'ofertujemy')`)
      .run(temat.identyfikator, temat.nazwa || lead.nazwa, lead.klient_id, lead.inwestycja_id, lead.osoba_id,
        lead.handlowiec, lead.zrodlo, temat.model_realizacji || 'Generalne wykonawstwo',
        temat.co_budujemy || null, temat.wartosc_kontraktu || 0, temat.marza_pct ?? 9,
        temat.termin_oferty || null, temat.termin_realizacji || null, temat.czas_trwania_mies || 12,
        karta.id, kamien.id, kamien.prawd_start);
    tematId = Number(r.lastInsertRowid);
    db.prepare('UPDATE leady SET temat_id = ?, status = ? WHERE id = ?').run(tematId, 'przekazany do pipeline', lead_id);
    logujLeada(lead_id, 'komitet', lead.kamien, 'BID', `Temat ${temat.identyfikator} utworzony w pipeline`);
    db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_po, opis) VALUES (?,?,?,?)')
      .run(tematId, 'utworzenie', `${kamien.nazwa} / ${kamien.prawd_start}%`,
        `Decyzja Komitetu: BID. Temat utworzony z leada "${lead.nazwa}".`);
  } else if (decyzja === 'no_bid') {
    db.prepare('UPDATE leady SET status = ?, powod_odpuszczenia = ? WHERE id = ?').run('odpuszczony', powod, lead_id);
    logujLeada(lead_id, 'komitet', lead.kamien, 'NO BID', powod);
  } else {
    logujLeada(lead_id, 'komitet', lead.kamien, 'DEFER', powod);
  }
  const r = db.prepare('INSERT INTO decyzje_komitetu (lead_id, temat_id, decyzja, powod, uzasadnienie) VALUES (?,?,?,?,?)')
    .run(lead_id, tematId, decyzja, powod || null, uzasadnienie || null);
  res.json({ id: Number(r.lastInsertRowid), temat_id: tematId });
});

// ---------- KARTY RATINGU / LEJKI ----------
api.get('/karty', (req, res) => {
  const karty = db.prepare('SELECT * FROM karty_ratingu WHERE aktywna = 1').all();
  for (const k of karty) {
    k.kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(k.id);
  }
  res.json(karty);
});

// Pelny obraz lejkow do edytora: kamienie + zadania + kryteria + powody + liczba tematow
api.get('/lejki', (req, res) => {
  const karty = db.prepare('SELECT * FROM karty_ratingu WHERE aktywna = 1 ORDER BY id').all();
  for (const k of karty) {
    k.liczba_tematow = db.prepare('SELECT COUNT(*) c FROM tematy WHERE karta_id = ?').get(k.id).c;
    k.kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(k.id);
    for (const km of k.kamienie) {
      km.zadania = db.prepare('SELECT * FROM task_szablony WHERE kamien_id = ? AND aktywny = 1 ORDER BY kolejnosc').all(km.id);
      km.kryteria = db.prepare('SELECT * FROM kamien_kryteria WHERE kamien_id = ? AND aktywny = 1 ORDER BY kolejnosc').all(km.id);
      km.powody = km.kod ? db.prepare('SELECT * FROM powody_zamkniecia WHERE kamien_kod = ? AND aktywny = 1').all(km.kod) : [];
      km.liczba_tematow = db.prepare('SELECT COUNT(*) c FROM tematy WHERE kamien_id = ? AND status = ?').get(km.id, 'otwarty').c;
    }
  }
  res.json(karty);
});

api.put('/karty/:id', (req, res) => {
  updateById('karty_ratingu', req.params.id, pick(req.body, ['nazwa', 'opis', 'persona', 'kod', 'aktywna']));
  res.json({ ok: true });
});

// Walidacja pasm kamieni lejka: rosnace, bez dziur i nakladek
function walidujPasma(kartaId, res) {
  const kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(kartaId);
  for (let i = 0; i < kamienie.length; i++) {
    const k = kamienie[i];
    if (k.prawd_min > k.prawd_max || k.prawd_start < k.prawd_min || k.prawd_start > k.prawd_max) {
      res.status(400).json({ error: `Kamień ${k.kod || k.nazwa}: start musi mieścić się w paśmie min–max` });
      return false;
    }
    if (i > 0 && k.prawd_min !== kamienie[i - 1].prawd_max + 1) {
      res.status(400).json({ error: `Pasma muszą być ciągłe: ${k.kod || k.nazwa} zaczyna się od ${k.prawd_min}, a poprzedni kończy na ${kamienie[i - 1].prawd_max} (oczekiwane ${kamienie[i - 1].prawd_max + 1})` });
      return false;
    }
  }
  return true;
}
api.post('/karty', (req, res) => {
  const { nazwa, opis = '' } = req.body;
  const r = db.prepare('INSERT INTO karty_ratingu (nazwa, opis) VALUES (?,?)').run(nazwa, opis);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/kamienie/:id', (req, res) => {
  const km = db.prepare('SELECT * FROM kamienie_karty WHERE id = ?').get(req.params.id);
  if (!km) return res.status(404).json({ error: 'Nie znaleziono kamienia' });
  updateById('kamienie_karty', req.params.id, pick(req.body,
    ['nazwa', 'kod', 'prawd_start', 'prawd_min', 'prawd_max', 'kolejnosc', 'prog_zastygniecia_dni', 'definicja_spelnienia', 'elastyczna_kolejnosc']));
  if (!walidujPasma(km.karta_id, res)) {
    // przywroc poprzednie wartosci pasm przy bledzie walidacji
    db.prepare('UPDATE kamienie_karty SET prawd_start=?, prawd_min=?, prawd_max=?, kolejnosc=? WHERE id=?')
      .run(km.prawd_start, km.prawd_min, km.prawd_max, km.kolejnosc, km.id);
    return;
  }
  res.json({ ok: true });
});
api.post('/karty/:id/kamienie', (req, res) => {
  const { nazwa, kod, prawd_start, prawd_min, prawd_max, kolejnosc, prog_zastygniecia_dni, definicja_spelnienia } = req.body;
  if (!nazwa) return res.status(400).json({ error: 'Nazwa kamienia (fakt po stronie klienta) jest wymagana' });
  const r = db.prepare(`INSERT INTO kamienie_karty
    (karta_id, kolejnosc, nazwa, kod, prawd_start, prawd_min, prawd_max, prog_zastygniecia_dni, definicja_spelnienia)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, kolejnosc ?? 99, nazwa, kod || null, prawd_start ?? 50, prawd_min ?? 0, prawd_max ?? 100,
      prog_zastygniecia_dni ?? null, definicja_spelnienia || null);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.delete('/kamienie/:id', (req, res) => {
  const uzyc = db.prepare('SELECT COUNT(*) c FROM tematy WHERE kamien_id = ?').get(req.params.id).c
    + db.prepare('SELECT COUNT(*) c FROM potwierdzenia_kamieni WHERE kamien_id = ?').get(req.params.id).c;
  if (uzyc > 0) return res.status(400).json({ error: 'Kamień jest używany przez tematy/potwierdzenia — nie można usunąć. Zmień jego definicję zamiast usuwać.' });
  db.prepare('DELETE FROM kamien_kryteria WHERE kamien_id = ?').run(req.params.id);
  db.prepare('DELETE FROM task_szablony WHERE kamien_id = ?').run(req.params.id);
  db.prepare('DELETE FROM kamienie_karty WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Biblioteka zadan (TaskTemplate) CRUD
api.post('/kamienie/:id/zadania', (req, res) => {
  const { nazwa, oczekiwany_efekt, co_dalej_sukces, co_dalej_porazka, typ } = req.body;
  if (!nazwa) return res.status(400).json({ error: 'Nazwa zadania jest wymagana' });
  const r = db.prepare(`INSERT INTO task_szablony (kamien_id, nazwa, oczekiwany_efekt, co_dalej_sukces, co_dalej_porazka, typ, kolejnosc)
    VALUES (?,?,?,?,?,?,99)`).run(req.params.id, nazwa, oczekiwany_efekt || null, co_dalej_sukces || null, co_dalej_porazka || null, typ || null);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/zadania-szablony/:id', (req, res) => {
  updateById('task_szablony', req.params.id, pick(req.body, ['nazwa', 'oczekiwany_efekt', 'co_dalej_sukces', 'co_dalej_porazka', 'typ', 'kolejnosc', 'aktywny']));
  res.json({ ok: true });
});
api.delete('/zadania-szablony/:id', (req, res) => {
  db.prepare('UPDATE task_szablony SET aktywny = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Kryteria kamienia (checklista etapu) CRUD
api.post('/kamienie/:id/kryteria', (req, res) => {
  const { tekst, obowiazkowe = 1 } = req.body;
  if (!tekst) return res.status(400).json({ error: 'Treść kryterium jest wymagana' });
  const r = db.prepare('INSERT INTO kamien_kryteria (kamien_id, tekst, obowiazkowe, kolejnosc) VALUES (?,?,?,99)')
    .run(req.params.id, tekst, obowiazkowe ? 1 : 0);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/kryteria/:id', (req, res) => {
  updateById('kamien_kryteria', req.params.id, pick(req.body, ['tekst', 'obowiazkowe', 'kolejnosc', 'aktywny']));
  res.json({ ok: true });
});
api.delete('/kryteria/:id', (req, res) => {
  db.prepare('UPDATE kamien_kryteria SET aktywny = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Powody zamkniecia CRUD (edytor lejkow)
api.post('/powody-zamkniecia', (req, res) => {
  const { kamien_kod, nazwa, czy_recyklingowalny = 0, offset_powrotu_mies = 0 } = req.body;
  if (!nazwa) return res.status(400).json({ error: 'Nazwa powodu jest wymagana' });
  const r = db.prepare('INSERT INTO powody_zamkniecia (kamien_kod, nazwa, czy_recyklingowalny, offset_powrotu_mies) VALUES (?,?,?,?)')
    .run(kamien_kod || null, nazwa, czy_recyklingowalny ? 1 : 0, offset_powrotu_mies || 0);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/powody-zamkniecia/:id', (req, res) => {
  updateById('powody_zamkniecia', req.params.id, pick(req.body, ['kamien_kod', 'nazwa', 'czy_recyklingowalny', 'offset_powrotu_mies', 'aktywny']));
  res.json({ ok: true });
});
api.delete('/powody-zamkniecia/:id', (req, res) => {
  db.prepare('UPDATE powody_zamkniecia SET aktywny = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- TEMATY (pipeline) ----------
const TEMAT_POLA = ['nazwa', 'klient_id', 'inwestycja_id', 'osoba_id', 'handlowiec', 'zrodlo',
  'model_realizacji', 'co_budujemy', 'data_startu', 'wartosc_kontraktu', 'marza_pct', 'termin_oferty',
  'termin_realizacji', 'czas_trwania_mies', 'czy_bierzemy', 'powod_odpuszczenia', 'notatki', 'tagi'];

// Kody kamieni komitetowych (bramka BID) - wspolne dla warstw Pipeline / New Business
const KODY_KOMITETU = ['M5', 'P5', 'K8', 'F3'];

api.get('/tematy', (req, res) => {
  sprawdzRecykling();
  const tematy = db.prepare(`
    SELECT t.*, k.nazwa AS klient_nazwa, km.nazwa AS kamien_nazwa, km.kod AS kamien_kod, km.kolejnosc AS kamien_kolejnosc,
      km.prawd_min, km.prawd_max, km.prog_zastygniecia_dni, kr.nazwa AS karta_nazwa, kr.kod AS pipeline_kod,
      (SELECT COUNT(*) FROM dzialania d WHERE d.temat_id = t.id AND d.status = 'planowane') AS dzialania_otwarte,
      EXISTS (SELECT 1 FROM potwierdzenia_kamieni pk JOIN kamienie_karty pkk ON pkk.id = pk.kamien_id
        WHERE pk.temat_id = t.id AND pkk.kod IN ('M5','P5','K8','F3')) AS po_bid
    FROM tematy t
    LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    ORDER BY km.kolejnosc DESC, t.wartosc_kontraktu DESC`).all();
  for (const t of tematy) { t.dni_w_etapie = dniWEtapie(t); t.zastygly = czyZastygly(t); }
  res.json(tematy);
});

// Warstwa 1 "Pipeline": arkuszowy poglad tematow PO pozytywnym Komitecie (w ofertowaniu).
// Proste kolumny jak w arkuszu KLA; % wygranej sterowany kamieniami + efektami dzialan.
api.get('/pipeline-ofertowanie', (req, res) => {
  sprawdzRecykling();
  const tematy = db.prepare(`
    SELECT t.*, k.nazwa AS klient_nazwa, km.nazwa AS kamien_nazwa, km.kod AS kamien_kod,
      km.kolejnosc AS kamien_kolejnosc, kr.kod AS pipeline_kod,
      (SELECT COUNT(*) FROM kamienie_karty kk WHERE kk.karta_id = t.karta_id) AS kamieni_lacznie,
      (SELECT d.cel FROM dzialania d WHERE d.temat_id = t.id AND d.status = 'planowane'
        ORDER BY d.termin IS NULL, d.termin LIMIT 1) AS najblizsze_dzialanie,
      (SELECT d.termin FROM dzialania d WHERE d.temat_id = t.id AND d.status = 'planowane'
        ORDER BY d.termin IS NULL, d.termin LIMIT 1) AS najblizszy_termin
    FROM tematy t
    LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    WHERE t.status = 'otwarty'
      AND EXISTS (SELECT 1 FROM potwierdzenia_kamieni pk JOIN kamienie_karty pkk ON pkk.id = pk.kamien_id
        WHERE pk.temat_id = t.id AND pkk.kod IN ('M5','P5','K8','F3'))
    ORDER BY t.prawdopodobienstwo DESC, t.wartosc_kontraktu DESC`).all();
  for (const t of tematy) {
    t.dni_w_etapie = dniWEtapie(t);
    t.stan_czasu = stanCzasu(t);
    t.prognoza = prognozaPodpisania(t);
    t.marza_mln = t.wartosc_kontraktu && t.marza_pct ? +(t.wartosc_kontraktu * t.marza_pct / 100).toFixed(2) : null;
  }
  const suma = tematy.reduce((s, t) => s + (t.wartosc_kontraktu || 0), 0);
  const wazona = tematy.reduce((s, t) => s + (t.wartosc_kontraktu || 0) * (t.prawdopodobienstwo || 0) / 100, 0);
  res.json({ tematy, suma: +suma.toFixed(1), wazona: +wazona.toFixed(1) });
});
api.get('/tematy/:id', (req, res) => {
  const t = db.prepare(`
    SELECT t.*, k.nazwa AS klient_nazwa, km.nazwa AS kamien_nazwa, km.kod AS kamien_kod, km.kolejnosc AS kamien_kolejnosc,
      km.prawd_min, km.prawd_max, km.definicja_spelnienia, km.prog_zastygniecia_dni,
      kr.nazwa AS karta_nazwa, kr.kod AS pipeline_kod, o.imie_nazwisko AS osoba_nazwa,
      i.nazwa AS inwestycja_nazwa
    FROM tematy t
    LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    LEFT JOIN osoby o ON o.id = t.osoba_id
    LEFT JOIN inwestycje i ON i.id = t.inwestycja_id
    WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  t.kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(t.karta_id);
  const potw = db.prepare('SELECT * FROM potwierdzenia_kamieni WHERE temat_id = ? ORDER BY data').all(t.id);
  const potwSet = new Set(potw.map(p => p.kamien_id));
  const odhaczone = new Set(db.prepare('SELECT kryterium_id FROM kryteria_odhaczenia WHERE temat_id = ?').all(t.id).map(r => r.kryterium_id));
  for (const km of t.kamienie) {
    km.potwierdzony = potwSet.has(km.id);
    km.szablony = db.prepare('SELECT * FROM task_szablony WHERE kamien_id = ? AND aktywny = 1 ORDER BY kolejnosc').all(km.id);
    km.kryteria = db.prepare('SELECT * FROM kamien_kryteria WHERE kamien_id = ? AND aktywny = 1 ORDER BY kolejnosc').all(km.id)
      .map(kr => ({ ...kr, odhaczone: odhaczone.has(kr.id) }));
  }
  t.potwierdzenia = potw;
  t.dni_w_etapie = dniWEtapie(t);
  t.zastygly = czyZastygly(t);
  t.szablony_kamienia = db.prepare('SELECT * FROM task_szablony WHERE kamien_id = ? AND aktywny = 1 ORDER BY kolejnosc').all(t.kamien_id);
  t.dzialania = db.prepare('SELECT * FROM dzialania WHERE temat_id = ? ORDER BY termin').all(t.id);
  t.historia = db.prepare('SELECT * FROM historia_tematu WHERE temat_id = ? ORDER BY data DESC').all(t.id);
  res.json(t);
});

// Potwierdzenie kamienia (MilestoneConfirmation) - JEDYNA droga awansu, wymaga dowodu
api.post('/tematy/:id/potwierdz-kamien', (req, res) => {
  const { kamien_id, dowod, potwierdzajacy } = req.body;
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  if (t.status !== 'otwarty') return res.status(400).json({ error: 'Temat nie jest otwarty' });
  const km = db.prepare('SELECT * FROM kamienie_karty WHERE id = ? AND karta_id = ?').get(kamien_id, t.karta_id);
  if (!km) return res.status(400).json({ error: 'Kamień nie należy do pipeline tego tematu' });
  if (!dowod) return res.status(400).json({ error: `Potwierdzenie kamienia "${km.kod}" wymaga dowodu (fakt po stronie klienta: notatka, data, dokument)` });
  if (db.prepare('SELECT 1 FROM potwierdzenia_kamieni WHERE temat_id = ? AND kamien_id = ?').get(t.id, kamien_id)) {
    return res.status(400).json({ error: 'Kamień już potwierdzony' });
  }
  // TWARDA bramka checklisty: wszystkie kryteria obowiazkowe kamienia musza byc odhaczone
  const brakujace = db.prepare(`SELECT kk.tekst FROM kamien_kryteria kk
    WHERE kk.kamien_id = ? AND kk.aktywny = 1 AND kk.obowiazkowe = 1
    AND NOT EXISTS (SELECT 1 FROM kryteria_odhaczenia ko WHERE ko.kryterium_id = kk.id AND ko.temat_id = ?)`)
    .all(kamien_id, t.id);
  if (brakujace.length) {
    return res.status(400).json({ error: `Nie odhaczono kryteriów obowiązkowych kamienia ${km.kod || ''}: ${brakujace.map(b => b.tekst).join('; ')}` });
  }
  db.prepare('INSERT INTO potwierdzenia_kamieni (temat_id, kamien_id, dowod, potwierdzajacy) VALUES (?,?,?,?)')
    .run(t.id, kamien_id, dowod, potwierdzajacy || t.handlowiec || null);
  const stan = przeliczTemat(t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'potwierdzenie kamienia', `${t.prawdopodobienstwo}%`, `${stan.prawdopodobienstwo}%`,
      `${km.kod} potwierdzony (dowód: ${String(dowod).slice(0, 120)})`);
  // WYGRANA potwierdzona -> temat obserwacyjny F1-watch
  const f1 = stan.wygrany ? utworzF1Watch(db.prepare('SELECT * FROM tematy WHERE id = ?').get(t.id)) : null;
  res.json({ ok: true, ...stan, f1_watch: f1 });
});

// Odhaczenie / cofniecie kryterium checklisty kamienia
api.post('/tematy/:id/kryterium', (req, res) => {
  const { kryterium_id, odhaczone, kto } = req.body;
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  const kr = db.prepare('SELECT * FROM kamien_kryteria WHERE id = ?').get(kryterium_id);
  if (!kr) return res.status(400).json({ error: 'Nieznane kryterium' });
  if (odhaczone) {
    db.prepare('INSERT OR IGNORE INTO kryteria_odhaczenia (temat_id, kryterium_id, kto) VALUES (?,?,?)')
      .run(t.id, kryterium_id, kto || t.handlowiec || null);
  } else {
    db.prepare('DELETE FROM kryteria_odhaczenia WHERE temat_id = ? AND kryterium_id = ?').run(t.id, kryterium_id);
  }
  const spelnione = db.prepare(`SELECT COUNT(*) c FROM kryteria_odhaczenia ko
    JOIN kamien_kryteria kk ON kk.id = ko.kryterium_id WHERE ko.temat_id = ? AND kk.kamien_id = ?`).get(t.id, kr.kamien_id).c;
  const wszystkie = db.prepare('SELECT COUNT(*) c FROM kamien_kryteria WHERE kamien_id = ? AND aktywny = 1').get(kr.kamien_id).c;
  res.json({ ok: true, spelnione, wszystkie });
});

// Cofniecie potwierdzenia (korekta) - z powodem
api.post('/tematy/:id/cofnij-kamien', (req, res) => {
  const { kamien_id, powod } = req.body;
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  if (!powod) return res.status(400).json({ error: 'Cofnięcie potwierdzenia wymaga powodu' });
  const km = db.prepare('SELECT * FROM kamienie_karty WHERE id = ?').get(kamien_id);
  db.prepare('DELETE FROM potwierdzenia_kamieni WHERE temat_id = ? AND kamien_id = ?').run(t.id, kamien_id);
  const stan = przeliczTemat(t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'cofnięcie kamienia', `${t.prawdopodobienstwo}%`, `${stan.prawdopodobienstwo}%`, `${km?.kod || ''} cofnięty: ${powod}`);
  res.json({ ok: true, ...stan });
});

// Zmiana ścieżki procesu. Dwa zastosowania:
//  • Reguła 7 — FAST-TRACK trafia na ścieżkę pełną (szeroki przetarg bez intencji
//    kontynuacji); kamienie do Komitetu auto-potwierdzone, bo klient przeszedł
//    kwalifikację w fast-tracku.
//  • Korekta ścieżki, gdy etap projektu inwestora okazał się inny, niż zakładaliśmy
//    przy zakładaniu tematu (np. projekt i pozwolenie jednak są gotowe).
// Bez wskazania docelowej ścieżki decyduje etap projektu z inwestycji.
const KAMIEN_KOMITETU = ['M5', 'P5', 'K8', 'F3'];

function zmienSciezke(req, res) {
  const { powod, pipeline_kod, auto_potwierdz = true } = req.body;
  const t = db.prepare(`SELECT t.*, kr.kod AS pipeline_kod, km.kod AS kamien_kod, i.etap_projektu
    FROM tematy t
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN inwestycje i ON i.id = t.inwestycja_id
    WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  if (!powod) return res.status(400).json({ error: 'Podaj powód zmiany ścieżki' });

  const cel = pipeline_kod
    ? db.prepare('SELECT * FROM karty_ratingu WHERE kod = ?').get(pipeline_kod)
    : kartaDlaEtapu(db, t.etap_projektu, false);
  if (!cel) return res.status(400).json({ error: 'Nie znaleziono docelowej ścieżki' });
  if (cel.id === t.karta_id) return res.status(400).json({ error: 'Temat jest już na tej ścieżce' });

  const kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(cel.id);
  const komitet = kamienie.find(k => KAMIEN_KOMITETU.includes(k.kod));

  db.exec('BEGIN');
  try {
    // Potwierdzenia dotyczą kamieni starej karty — nie da się ich przenieść wprost.
    db.prepare('DELETE FROM potwierdzenia_kamieni WHERE temat_id = ?').run(t.id);
    db.prepare('UPDATE tematy SET karta_id = ? WHERE id = ?').run(cel.id, t.id);

    // Fast-track dotarł do etapu kwalifikacji, więc na pełnej ścieżce wszystko
    // przed Komitetem jest już faktem; przy zwykłej korekcie ścieżki nie zgadujemy.
    const doPotwierdzenia = (auto_potwierdz && t.pipeline_kod === 'FAST_TRACK' && komitet)
      ? kamienie.filter(k => k.kolejnosc < komitet.kolejnosc) : [];
    for (const km of doPotwierdzenia) {
      db.prepare('INSERT INTO potwierdzenia_kamieni (temat_id, kamien_id, dowod, potwierdzajacy) VALUES (?,?,?,?)')
        .run(t.id, km.id, `Przeniesiony z ${t.pipeline_kod}: ${powod}`, t.handlowiec || null);
    }
    // Działania i wejścia w etap wskazują kamienie starej karty — czyścimy dowiązanie,
    // żeby licznik czasu w etapie i biblioteka zadań liczyły się od nowej ścieżki.
    db.prepare('UPDATE dzialania SET kamien_id = NULL, template_id = NULL WHERE temat_id = ?').run(t.id);
    db.prepare('DELETE FROM kryteria_odhaczenia WHERE temat_id = ?').run(t.id);
    db.prepare('DELETE FROM milestone_wejscia WHERE temat_id = ?').run(t.id);

    const stan = przeliczTemat(t.id);
    db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
      .run(t.id, 'zmiana ścieżki', `${t.pipeline_kod} ${t.kamien_kod}`, `${cel.kod} ${stan.osiagniety_kod || kamienie[0].kod}`, powod);
    db.exec('COMMIT');
    res.json({ ok: true, pipeline: cel.nazwa, pipeline_kod: cel.kod, ...stan });
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

api.post('/tematy/:id/przenies-sciezke', zmienSciezke);
// Stary adres — zachowany, bo używa go widok tematu
api.post('/tematy/:id/przenies-standard', zmienSciezke);

// Powody zamkniecia dla etapu (per kamien_kod)
api.get('/powody-zamkniecia', (req, res) => {
  const { kamien_kod } = req.query;
  let sql = 'SELECT * FROM powody_zamkniecia WHERE aktywny = 1';
  const params = [];
  if (kamien_kod) { sql += ' AND (kamien_kod = ? OR kamien_kod IS NULL)'; params.push(kamien_kod); }
  res.json(db.prepare(sql + ' ORDER BY kamien_kod, id').all(...params));
});

// Pula recyklingu + reczne sprawdzenie
api.get('/recykling', (req, res) => {
  sprawdzRecykling();
  res.json(db.prepare(`SELECT t.*, k.nazwa AS klient_nazwa, km.kod AS kamien_kod, km.nazwa AS kamien_nazwa
    FROM tematy t LEFT JOIN klienci k ON k.id = t.klient_id LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    WHERE t.status = 'recycled' ORDER BY t.recycle_date`).all());
});
api.put('/tematy/:id', (req, res) => {
  updateById('tematy', req.params.id, pick(req.body, TEMAT_POLA));
  res.json({ ok: true });
});

api.post('/tematy/:id/kamien', (req, res) => {
  const { kamien_id, powod } = req.body;
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  const nowy = db.prepare('SELECT * FROM kamienie_karty WHERE id = ? AND karta_id = ?').get(kamien_id, t.karta_id);
  if (!nowy) return res.status(400).json({ error: 'Kamien nie nalezy do karty tego tematu' });
  const stary = db.prepare('SELECT * FROM kamienie_karty WHERE id = ?').get(t.kamien_id);
  const cofniecie = stary && nowy.kolejnosc < stary.kolejnosc;
  if (cofniecie && !powod) return res.status(400).json({ error: 'Cofniecie kamienia wymaga podania powodu' });

  db.prepare('UPDATE tematy SET kamien_id = ?, prawdopodobienstwo = ?, korekta_reczna = 0 WHERE id = ?')
    .run(kamien_id, nowy.prawd_start, t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, cofniecie ? 'cofniecie kamienia' : 'awans kamienia',
      `${stary?.nazwa ?? '-'} / ${t.prawdopodobienstwo}%`, `${nowy.nazwa} / ${nowy.prawd_start}%`,
      powod || 'Decyzja handlowca');

  if (nowy.prawd_start >= 100) {
    db.prepare('UPDATE tematy SET status = ? WHERE id = ?').run('wygrany', t.id);
  }
  res.json({ ok: true, prawdopodobienstwo: nowy.prawd_start });
});

api.post('/tematy/:id/prawdopodobienstwo', (req, res) => {
  const { wartosc } = req.body;
  const t = db.prepare(`SELECT t.*, km.prawd_min, km.prawd_max, km.nazwa AS kamien_nazwa
    FROM tematy t LEFT JOIN kamienie_karty km ON km.id = t.kamien_id WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  const w = Number(wartosc);
  if (w < t.prawd_min || w > t.prawd_max) {
    return res.status(400).json({ error: `Korekta poza zakresem kamienia "${t.kamien_nazwa}" (${t.prawd_min}-${t.prawd_max}%). Zmien kamien zamiast korygowac.` });
  }
  db.prepare('UPDATE tematy SET prawdopodobienstwo = ?, korekta_reczna = 1 WHERE id = ?').run(w, t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'korekta reczna', `${t.prawdopodobienstwo}%`, `${w}%`, 'Korekta reczna handlowca w ramach kamienia');
  res.json({ ok: true });
});

api.post('/tematy/:id/zamknij', (req, res) => {
  const { status, przyczyna, powod_id, opis } = req.body;
  if (!['wygrany', 'przegrany', 'odrzucony', 'wstrzymany'].includes(status)) {
    return res.status(400).json({ error: 'Nieznany status zamkniecia' });
  }
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });

  // Powod przegranej/odrzucenia = slownik per etap (moze byc recyklingowalny)
  let powod = przyczyna || null, recyklPowrot = null;
  if (['przegrany', 'odrzucony'].includes(status)) {
    if (!powod_id && !przyczyna) return res.status(400).json({ error: 'Powód zamknięcia (słownik per etap) jest obowiązkowy' });
    if (powod_id) {
      const p = db.prepare('SELECT * FROM powody_zamkniecia WHERE id = ?').get(powod_id);
      if (!p) return res.status(400).json({ error: 'Nieznany powód zamknięcia' });
      powod = p.nazwa;
      if (p.czy_recyklingowalny) {
        recyklPowrot = db.prepare(`SELECT date('now', '+' || ? || ' months') d`).get(p.offset_powrotu_mies || 6).d;
      }
    }
  }
  if (status === 'wygrany' && !przyczyna) return res.status(400).json({ error: 'Kod przyczyny jest obowiazkowy przy wygranej' });

  if (recyklPowrot) {
    // Nie tracimy leada - trafia do puli recyklingu z data powrotu
    db.prepare('UPDATE tematy SET status = ?, przyczyna_zamkniecia = ?, przyczyna_opis = ?, recycle_date = ? WHERE id = ?')
      .run('recycled', powod, opis || null, recyklPowrot, t.id);
    db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
      .run(t.id, 'recykling', t.status, 'recycled', `${powod} — powrót ${recyklPowrot}`);
    return res.json({ ok: true, recycled: true, recycle_date: recyklPowrot });
  }
  const prawd = status === 'wygrany' ? 100 : (['przegrany', 'odrzucony'].includes(status) ? 0 : t.prawdopodobienstwo);
  db.prepare('UPDATE tematy SET status = ?, przyczyna_zamkniecia = ?, przyczyna_opis = ?, prawdopodobienstwo = ? WHERE id = ?')
    .run(status, powod, opis || null, prawd, t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'zamkniecie', t.status, status, `${powod || ''} ${opis || ''}`.trim());
  const f1 = status === 'wygrany' ? utworzF1Watch(t) : null;
  res.json({ ok: true, f1_watch: f1 });
});

api.post('/tematy/:id/otworz', (req, res) => {
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  db.prepare('UPDATE tematy SET status = ?, przyczyna_zamkniecia = NULL WHERE id = ?').run('otwarty', t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'otwarcie', t.status, 'otwarty', 'Temat ponownie otwarty');
  res.json({ ok: true });
});

// ---------- DZIALANIA (outcome-driven) ----------
const DZIALANIE_POLA = ['typ', 'cel', 'opis', 'lead_id', 'temat_id', 'klient_id', 'osoba_id',
  'kamien_id', 'termin', 'status', 'notatki', 'template_id'];

api.get('/dzialania', (req, res) => {
  const { zakres } = req.query;
  let sql = `SELECT d.*, t.identyfikator AS temat_identyfikator, l.nazwa AS lead_nazwa, k.nazwa AS klient_nazwa
    FROM dzialania d
    LEFT JOIN tematy t ON t.id = d.temat_id
    LEFT JOIN leady l ON l.id = d.lead_id
    LEFT JOIN klienci k ON k.id = d.klient_id`;
  if (zakres === 'tydzien') {
    sql += ` WHERE d.status = 'planowane' AND (d.termin IS NULL OR d.termin <= date('now', '+7 days'))`;
  }
  sql += ' ORDER BY d.termin IS NULL, d.termin';
  res.json(db.prepare(sql).all());
});
api.post('/dzialania', (req, res) => {
  const d = pick(req.body, DZIALANIE_POLA);
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO dzialania (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => d[k]));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/dzialania/:id', (req, res) => {
  updateById('dzialania', req.params.id, pick(req.body, DZIALANIE_POLA));
  res.json({ ok: true });
});

// Wynik dzialania (v2): zapis efektu osiagniety/nieosiagniety + podpowiedz "co dalej" z szablonu.
// Prawdopodobienstwo NIE zmienia sie z dzialan - w v2 pcha je wylacznie potwierdzenie kamienia.
api.post('/dzialania/:id/wynik', (req, res) => {
  const { wynik } = req.body;
  const d = db.prepare('SELECT * FROM dzialania WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Nie znaleziono dzialania' });
  if (d.wynik) return res.status(400).json({ error: 'Dzialanie ma juz zapisany wynik' });
  const slownik = db.prepare('SELECT * FROM slowniki WHERE typ = ? AND wartosc = ? AND aktywny = 1')
    .get('wynik_dzialania', wynik);
  if (!slownik) return res.status(400).json({ error: 'Nieznany wynik dzialania (sprawdz slownik)' });

  db.prepare(`UPDATE dzialania SET wynik = ?, status = ?, data_wykonania = datetime('now') WHERE id = ?`).run(wynik, 'wykonane', d.id);

  // Podpowiedz kolejnego kroku z biblioteki (sukces vs porazka)
  let coDalej = null;
  if (d.template_id) {
    const tpl = db.prepare('SELECT co_dalej_sukces, co_dalej_porazka FROM task_szablony WHERE id = ?').get(d.template_id);
    coDalej = /osi[ąa]gni[ęe]ty|cz[ęe][śs]ciowo/i.test(wynik) ? tpl?.co_dalej_sukces : tpl?.co_dalej_porazka;
  }
  res.json({ ok: true, co_dalej: coDalej || null });
});

// ---------- ROADMAPA TYGODNIA + PULPIT POSTEPOW (widok startowy) ----------
api.get('/roadmapa', (req, res) => {
  sprawdzRecykling();
  const tematyOtwarte = db.prepare(`
    SELECT t.*, k.nazwa AS klient_nazwa, km.kod AS kamien_kod, km.nazwa AS kamien_nazwa,
      km.prog_zastygniecia_dni, kr.nazwa AS pipeline_nazwa, kr.kod AS pipeline_kod
    FROM tematy t LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    WHERE t.status = 'otwarty'`).all();
  for (const t of tematyOtwarte) { t.dni_w_etapie = dniWEtapie(t); t.zastygly = czyZastygly(t); }

  // Zadania tygodnia (temat + lead) z podpowiedzia efektu i "co dalej" z szablonu
  const zadania = db.prepare(`
    SELECT d.*, t.identyfikator AS temat_identyfikator, t.id AS t_id, km.kod AS kamien_kod,
      l.nazwa AS lead_nazwa, k.nazwa AS klient_nazwa,
      ts.oczekiwany_efekt, ts.co_dalej_sukces, ts.co_dalej_porazka
    FROM dzialania d
    LEFT JOIN tematy t ON t.id = d.temat_id
    LEFT JOIN leady l ON l.id = d.lead_id
    LEFT JOIN klienci k ON k.id = COALESCE(d.klient_id, t.klient_id, l.klient_id)
    LEFT JOIN kamienie_karty km ON km.id = d.kamien_id
    LEFT JOIN task_szablony ts ON ts.id = d.template_id
    WHERE d.status = 'planowane' AND (d.termin IS NULL OR d.termin <= date('now', '+7 days'))
    ORDER BY d.termin IS NULL, d.termin`).all();

  // Tematy bez otwartego zadania (regula "zawsze nastepny krok")
  const bezRuchu = tematyOtwarte.filter(t =>
    !db.prepare(`SELECT 1 FROM dzialania WHERE temat_id = ? AND status = 'planowane' LIMIT 1`).get(t.id));

  const zastygle = tematyOtwarte.filter(t => t.zastygly);
  const wartoscWazona = tematyOtwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0) * (t.prawdopodobienstwo || 0) / 100, 0);

  // Postep wg kamienia (kod) per pipeline
  const wgKamienia = {};
  for (const t of tematyOtwarte) {
    const key = `${t.pipeline_kod || '?'}|${t.kamien_kod || '?'}`;
    wgKamienia[key] = (wgKamienia[key] || 0) + 1;
  }
  const recyklingDue = db.prepare(`SELECT COUNT(*) c FROM tematy WHERE status = 'recycled'`).get().c;

  // Skrot PDCA na roadmapie: ile tematow wypadlo z normy czasu i ile czeka
  // na decyzje korygujaca. Szczegoly w karcie PDCA.
  for (const t of tematyOtwarte) t.stan_czasu = stanCzasu(t);
  const opoznione = tematyOtwarte.filter(t => t.stan_czasu.stan === 'opozniony');
  const wymagaDecyzji = tematyOtwarte.filter(t => stanPdca(t).wymaga_decyzji);

  // Operacyjne przypominajki przejete z Pulpitu KPI (scalony z Roadmapa)
  const kolejkaKomitetu = tematyOtwarte.filter(t => ['M5', 'P5', 'K8', 'F3'].includes(t.kamien_kod)).length;
  const leadyA = db.prepare(`SELECT COUNT(*) c FROM leady WHERE status = 'aktywny' AND priorytet = 'A'`).get().c;

  res.json({
    zadania, bez_ruchu: bezRuchu, zastygle,
    postep: {
      tematy_otwarte: tematyOtwarte.length, wartosc_wazona: wartoscWazona,
      liczba_zastygle: zastygle.length, liczba_bez_ruchu: bezRuchu.length,
      wg_kamienia: wgKamienia, recykling: recyklingDue,
      liczba_opoznione: opoznione.length,
      liczba_wymaga_decyzji: wymagaDecyzji.length,
      kolejka_komitetu: kolejkaKomitetu,
      leady_a: leadyA,
    },
  });
});

// ---------- INWESTYCJE ----------
const INW_POLA = ['nazwa', 'opis', 'typ_inwestora', 'co_powstaje', 'branza', 'wojewodztwo', 'miasto',
  'wartosc_inwestycji', 'powierzchnia', 'etap_projektu', 'zrodlo', 'id_zrodlowe', 'data_pozyskania'];
api.get('/inwestycje', (req, res) => {
  res.json(db.prepare('SELECT * FROM inwestycje ORDER BY utworzono DESC').all());
});
api.post('/inwestycje', (req, res) => {
  const d = pick(req.body, INW_POLA);
  if (d.id_zrodlowe) {
    const istnieje = db.prepare('SELECT id FROM inwestycje WHERE id_zrodlowe = ?').get(d.id_zrodlowe);
    if (istnieje) return res.json({ id: istnieje.id, duplikat: true });
  }
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO inwestycje (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => d[k]));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/inwestycje/:id', (req, res) => {
  updateById('inwestycje', req.params.id, pick(req.body, INW_POLA));
  res.json({ ok: true });
});

// ---------- IMPORT LEADOW ----------
api.post('/import/parse', (req, res) => {
  const { base64, nazwa_pliku } = req.body;
  if (!base64) return res.status(400).json({ error: 'Brak pliku' });
  const bufor = Buffer.from(base64, 'base64');
  res.json(parsujPlik(bufor, nazwa_pliku || 'import'));
});

// Podglad: wybory z heurystyk + punkty policzone wersja scoringu wskazanej grupy
api.post('/import/podglad', (req, res) => {
  const { base64, zakladka, wersja_id } = req.body;
  if (!base64 || !zakladka) return res.status(400).json({ error: 'Brak pliku lub zakładki' });
  if (!wersja_id) return res.status(400).json({ error: 'Wskaż wersję scoringu (przez wybór grupy)' });
  const bufor = Buffer.from(base64, 'base64');
  const wynik = przygotujImport(bufor, zakladka);

  const poId = db.prepare('SELECT id FROM inwestycje WHERE id_zrodlowe = ?');
  const poNazwie = db.prepare('SELECT id FROM inwestycje WHERE nazwa = ?');
  const leadInw = db.prepare('SELECT id, grupa_id FROM leady WHERE inwestycja_id = ?');

  for (const p of wynik.propozycje) {
    const score = policzScore(p.wybory, wersja_id);
    p.score_total = score.total;
    p.priorytet = score.priorytet;
    p.dyskwalifikacja = score.dyskwalifikacja;
    p.dyskwalifikacja_powod = score.powod;
    p.braki = score.braki;
    // Naklad baz: inwestycja juz w CRM -> wystapienie, nie duplikat
    const istniejaca = p.id_zrodlowe ? poId.get(String(p.id_zrodlowe)) : poNazwie.get(p.nazwa_inwestycji);
    p.inwestycja_id = istniejaca?.id || null;
    const istniejacyLead = istniejaca ? leadInw.get(istniejaca.id) : null;
    p.istniejacy_lead_id = istniejacyLead?.id || null;
    p.wystapienie = !!istniejacyLead;
  }
  wynik.propozycje.sort((a, b) => b.score_total - a.score_total);
  res.json(wynik);
});

// Wykonanie importu do grupy: nowe leady + wystapienia dla istniejacych (aktualizacja etapu/kosztu)
api.post('/import/wykonaj', (req, res) => {
  const { wiersze, grupa_id, handlowiec, zrodlo } = req.body;
  if (!Array.isArray(wiersze) || !wiersze.length) return res.status(400).json({ error: 'Brak wierszy do importu' });
  if (!grupa_id) return res.status(400).json({ error: 'Import wymaga wskazania grupy leadów' });
  const grupa = db.prepare('SELECT * FROM grupy_leadow WHERE id = ?').get(grupa_id);
  if (!grupa?.wersja_id) return res.status(400).json({ error: 'Grupa nie istnieje lub nie ma wersji scoringu' });

  const zrodloWpisu = zrodlo || 'Baza sygnałów (KI)';
  const stat = { leady_nowe: 0, wystapienia: 0, aktualizacje_danych: 0, zmiany_priorytetu: 0, klienci_nowi: 0, dyskwalifikacje: 0 };

  const znajdzInwPoId = db.prepare('SELECT * FROM inwestycje WHERE id_zrodlowe = ?');
  const znajdzInwPoNazwie = db.prepare('SELECT * FROM inwestycje WHERE nazwa = ?');
  const znajdzKlienta = db.prepare('SELECT id FROM klienci WHERE lower(nazwa) = lower(?)');
  const znajdzLead = db.prepare('SELECT * FROM leady WHERE inwestycja_id = ?');

  const wstawInw = db.prepare(`INSERT INTO inwestycje
    (nazwa, opis, typ_inwestora, co_powstaje, branza, wojewodztwo, miasto, wartosc_inwestycji, powierzchnia, etap_projektu, zrodlo, id_zrodlowe, data_pozyskania)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,date('now'))`);
  const wstawKlienta = db.prepare(`INSERT INTO klienci (nazwa, zrodlo_pozyskania, branza, miasto, wojewodztwo, notatki) VALUES (?,?,?,?,?,?)`);
  const wstawLead = db.prepare(`INSERT INTO leady
    (nazwa, klient_id, inwestycja_id, grupa_id, wersja_id, handlowiec, zrodlo, kamien, prawd_kwalifikacji,
     wybory, score_total, priorytet, dyskwalifikacja_x, dyskwalifikacja_powod, status_researchu, research_notatka, notatki,
     identyfikator, sposob_pozyskania)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const wstawWystapienie = db.prepare('INSERT INTO lead_wystapienia (lead_id, grupa_id, notatka) VALUES (?,?,?)');

  db.exec('BEGIN');
  try {
    for (const p of wiersze) {
      const score = policzScore(p.wybory, grupa.wersja_id);

      // Inwestycja: nowa lub istniejaca (naklad baz)
      let inw = p.id_zrodlowe ? znajdzInwPoId.get(String(p.id_zrodlowe)) : znajdzInwPoNazwie.get(p.nazwa_inwestycji);
      if (!inw) {
        const rId = Number(wstawInw.run(
          p.nazwa_inwestycji, p.informacje || null, 'prywatny', p.podsektor || null, p.branza || null,
          p.wojewodztwo || null, p.miasto || null, Number(p.koszt) || null, Number(p.powierzchnia) || null,
          p.etap || null, zrodloWpisu, p.id_zrodlowe ? String(p.id_zrodlowe) : null).lastInsertRowid);
        inw = { id: rId, etap_projektu: p.etap, wartosc_inwestycji: Number(p.koszt) || null };
      }

      const istniejacyLead = znajdzLead.get(inw.id);
      if (istniejacyLead) {
        // Wystapienie w kolejnej grupie: adnotacja + aktualizacja danych + WZBOGACENIE researchem
        stat.wystapienia++;
        wstawWystapienie.run(istniejacyLead.id, grupa_id, `Wystąpił w imporcie do grupy "${grupa.nazwa}"`);

        const zmiany = [];
        if (p.etap && p.etap !== inw.etap_projektu) zmiany.push(['etap_projektu', inw.etap_projektu, p.etap]);
        const kosztNowy = Number(p.koszt) || null;
        if (kosztNowy && kosztNowy !== inw.wartosc_inwestycji) zmiany.push(['wartosc_inwestycji', inw.wartosc_inwestycji, kosztNowy]);

        const wybory = JSON.parse(istniejacyLead.wybory || '{}');
        let wyboryZmienione = false;
        if (zmiany.length) {
          stat.aktualizacje_danych++;
          for (const [pole, , po] of zmiany) {
            db.prepare(`UPDATE inwestycje SET ${pole} = ? WHERE id = ?`).run(po, inw.id);
          }
          if (p.wybory.B) { wybory.B = p.wybory.B; wyboryZmienione = true; }
          if (p.wybory.D) { wybory.D = p.wybory.D; wyboryZmienione = true; }
          logujLeada(istniejacyLead.id, 'aktualizacja z importu',
            zmiany.map(z => `${z[0]}: ${z[1] ?? '—'}`).join(', '),
            zmiany.map(z => `${z[0]}: ${z[2]}`).join(', '),
            `Świeże dane z importu do grupy "${grupa.nazwa}"`);
        }
        // Jawne dane researchu z arkusza nadpisuja heurystyki na istniejacym leadzie
        if (p.jawne?.e3 && wybory.E3 !== p.wybory.E3) { wybory.E3 = p.wybory.E3; wyboryZmienione = true; }
        if (p.jawne?.f && wybory.F !== p.wybory.F) { wybory.F = p.wybory.F; wyboryZmienione = true; }
        if (p.klasyfikacja && p.wybory.C && wybory.C !== p.wybory.C) { wybory.C = p.wybory.C; wyboryZmienione = true; }
        if (p.branza && p.wybory.E2 && wybory.E2 !== p.wybory.E2) { wybory.E2 = p.wybory.E2; wyboryZmienione = true; }
        if (wyboryZmienione) {
          db.prepare('UPDATE leady SET wybory = ? WHERE id = ?').run(JSON.stringify(wybory), istniejacyLead.id);
          if (istniejacyLead.wersja_id) {
            const wynik = przeliczLeada(istniejacyLead.id, istniejacyLead.wersja_id, 'Wzbogacenie researchem z importu');
            if (wynik.priorytet !== istniejacyLead.priorytet) stat.zmiany_priorytetu++;
          }
        }
        if (p.jawne?.research) {
          const mapaR = { 'ZIELONE': 'ZIELONY', 'ŻÓŁTE': 'ŻÓŁTY', 'CZERWONE': 'CZERWONY' };
          const nowyR = mapaR[p.status_researchu_arkusz];
          if (nowyR && istniejacyLead.status_researchu !== nowyR) {
            db.prepare('UPDATE leady SET status_researchu = ?, research_notatka = COALESCE(?, research_notatka) WHERE id = ?')
              .run(nowyR, p.research_notatka || null, istniejacyLead.id);
            logujLeada(istniejacyLead.id, 'research', istniejacyLead.status_researchu, nowyR, 'Research z arkusza importu');
          }
        }
        // NIP/kontakt firmy inwestora na kliencie (gdy brak)
        if (p.firma && istniejacyLead.klient_id) {
          db.prepare(`UPDATE klienci SET nip = COALESCE(nip, ?), miasto = COALESCE(miasto, ?), wojewodztwo = COALESCE(wojewodztwo, ?) WHERE id = ?`)
            .run(p.firma.nip, p.firma.miasto, p.firma.wojewodztwo, istniejacyLead.klient_id);
        }
        continue;
      }

      // Klient (dedup po nazwie) + dane firmy inwestora (NIP, kontakt) z zakladki Firmy
      let klientId = null;
      if (p.klient_nazwa) {
        const istKlient = znajdzKlienta.get(p.klient_nazwa);
        if (istKlient) {
          klientId = istKlient.id;
          if (p.firma) {
            db.prepare(`UPDATE klienci SET nip = COALESCE(nip, ?), miasto = COALESCE(miasto, ?), wojewodztwo = COALESCE(wojewodztwo, ?) WHERE id = ?`)
              .run(p.firma.nip, p.firma.miasto, p.firma.wojewodztwo, klientId);
          }
        } else {
          const notatkiKlienta = [
            p.inwestor && p.inwestor !== p.klient_nazwa ? 'Pełne pole Inwestor z importu: ' + p.inwestor : null,
            p.firma?.telefon ? 'Tel: ' + p.firma.telefon : null,
            p.firma?.email ? 'E-mail: ' + p.firma.email : null,
            p.firma?.www ? 'WWW: ' + p.firma.www : null,
          ].filter(Boolean).join('\n');
          klientId = Number(db.prepare(`INSERT INTO klienci (nazwa, nip, zrodlo_pozyskania, branza, miasto, wojewodztwo, notatki)
            VALUES (?,?,?,?,?,?,?)`).run(
            p.klient_nazwa, p.firma?.nip || null, zrodloWpisu, p.branza || null,
            p.firma?.miasto || p.miasto || null, p.firma?.wojewodztwo || p.wojewodztwo || null,
            notatkiKlienta || null).lastInsertRowid);
          stat.klienci_nowi++;
        }
      }

      // Status researchu z arkusza TOP (ZIELONE/ZOLTE/CZERWONE) -> mapowanie na status leada
      const mapaResearch = { 'ZIELONE': 'ZIELONY', 'ŻÓŁTE': 'ŻÓŁTY', 'CZERWONE': 'CZERWONY' };
      const statusResearchu = mapaResearch[p.status_researchu_arkusz] || 'SZARY';
      const notatki = [
        p.score_zewnetrzny ? `Scoring z arkusza (research): ${p.score_zewnetrzny} / ${p.priorytet_zewnetrzny || ''}` : null,
        p.klasyfikacja ? `Klasyfikacja z arkusza: ${p.klasyfikacja}` : null,
        p.do_weryfikacji ? 'Profil inwestora (C) / branża (E2) nadane heurystycznie — do weryfikacji.' : null,
      ].filter(Boolean).join('\n');

      const idTematu = generujIdTematu(p.klient_nazwa, p.wybory.A, p.nazwa_inwestycji);
      const sposob = zrodloWpisu.includes('KI') || zrodloWpisu.toLowerCase().includes('sygnał') ? 'Prospecting NB' : null;
      const rLead = wstawLead.run(
        p.nazwa_inwestycji + (p.klient_nazwa ? ` (${p.klient_nazwa})` : ''),
        klientId, inw.id, grupa_id, grupa.wersja_id, handlowiec || null, zrodloWpisu, 'Lead surowy', 10,
        JSON.stringify(p.wybory), score.total, score.priorytet, score.dyskwalifikacja,
        score.powod || null, statusResearchu,
        p.research_notatka || (statusResearchu !== 'SZARY' ? 'Status researchu przeniesiony z arkusza importu' : null),
        notatki || null, idTematu, sposob);
      logujLeada(Number(rLead.lastInsertRowid), 'utworzenie', null, `${score.total} / ${score.priorytet}`,
        `Import do grupy "${grupa.nazwa}" · ID ${idTematu}`);
      stat.leady_nowe++;
      if (score.dyskwalifikacja) stat.dyskwalifikacje++;
    }
    zamrozWersje(grupa.wersja_id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(stat);
});

// ---------- PYTANIA KWALIFIKACJI WSTEPNEJ (konfiguracja) ----------
api.get('/pytania-kwalifikacji', (req, res) => {
  res.json(db.prepare('SELECT * FROM pytania_kwalifikacji WHERE aktywny = 1 ORDER BY kolejnosc').all());
});
api.post('/pytania-kwalifikacji', (req, res) => {
  const { tekst, dyskwalifikujace = 0 } = req.body;
  if (!tekst) return res.status(400).json({ error: 'Treść pytania jest wymagana' });
  const max = db.prepare('SELECT COALESCE(MAX(kolejnosc),-1) m FROM pytania_kwalifikacji').get().m;
  const r = db.prepare('INSERT INTO pytania_kwalifikacji (tekst, kolejnosc, dyskwalifikujace) VALUES (?,?,?)')
    .run(tekst, max + 1, dyskwalifikujace ? 1 : 0);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/pytania-kwalifikacji/:id', (req, res) => {
  updateById('pytania_kwalifikacji', req.params.id, pick(req.body, ['tekst', 'dyskwalifikujace', 'kolejnosc', 'aktywny']));
  res.json({ ok: true });
});
api.delete('/pytania-kwalifikacji/:id', (req, res) => {
  db.prepare('UPDATE pytania_kwalifikacji SET aktywny = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- PARTNERZY BIZNESOWI ----------
const PARTNER_POLA = ['nazwa', 'typ', 'osoba_kontakt', 'email', 'telefon', 'etap', 'potencjal', 'notatki'];
api.get('/partnerzy', (req, res) => {
  res.json(db.prepare('SELECT * FROM partnerzy ORDER BY nazwa').all());
});
api.post('/partnerzy', (req, res) => {
  const d = pick(req.body, PARTNER_POLA);
  if (!d.nazwa) return res.status(400).json({ error: 'Nazwa partnera jest wymagana' });
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO partnerzy (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => d[k]));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/partnerzy/:id', (req, res) => {
  updateById('partnerzy', req.params.id, pick(req.body, PARTNER_POLA));
  res.json({ ok: true });
});

// ---------- RAPORT WIN/LOSS (przeglad Dyr. Sprzedazy + Marketing) ----------
api.get('/raporty/win-loss', (req, res) => {
  const wygrane = db.prepare(`SELECT przyczyna_zamkniecia AS przyczyna, COUNT(*) c FROM tematy
    WHERE status = 'wygrany' GROUP BY przyczyna_zamkniecia ORDER BY c DESC`).all();
  const przegrane = db.prepare(`SELECT przyczyna_zamkniecia AS przyczyna, COUNT(*) c FROM tematy
    WHERE status = 'przegrany' GROUP BY przyczyna_zamkniecia ORDER BY c DESC`).all();
  // Odpuszczenia leadow (przedkomitetowe) + decyzje NO-BID Komitetu (pokomitetowe)
  const odpuszczoneLeady = db.prepare(`SELECT powod_odpuszczenia AS powod, COUNT(*) c FROM leady
    WHERE status = 'odpuszczony' GROUP BY powod_odpuszczenia ORDER BY c DESC`).all();
  const noBid = db.prepare(`SELECT powod, COUNT(*) c FROM decyzje_komitetu
    WHERE decyzja = 'no_bid' GROUP BY powod ORDER BY c DESC`).all();
  const wygraneN = wygrane.reduce((s, r) => s + r.c, 0);
  const przegraneN = przegrane.reduce((s, r) => s + r.c, 0);
  res.json({
    win_rate: (wygraneN + przegraneN) ? Math.round(100 * wygraneN / (wygraneN + przegraneN)) : null,
    wygrane, przegrane, odpuszczone_leady: odpuszczoneLeady, no_bid: noBid,
    lista: db.prepare(`SELECT identyfikator, nazwa, klient_id, status, przyczyna_zamkniecia, przyczyna_opis, wartosc_kontraktu
      FROM tematy WHERE status IN ('wygrany','przegrany') ORDER BY utworzono DESC LIMIT 100`).all(),
  });
});

// Pakiet handoff do ZOS/Intense z poziomu tematu (krok 2 modelu integracji CRM->Intense)
api.get('/tematy/:id/zos', (req, res) => {
  const t = db.prepare(`SELECT t.*, k.nazwa AS klient_nazwa, k.nip, k.branza AS klient_branza,
      i.nazwa AS inwestycja_nazwa, i.wojewodztwo, i.miasto AS inwestycja_miasto, i.wartosc_inwestycji, i.etap_projektu,
      o.imie_nazwisko AS osoba_nazwa, o.stanowisko, o.email, o.telefon,
      l.sposob_pozyskania, l.zrodlo_wiedzy_wpip, l.score_total, l.priorytet
    FROM tematy t LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN inwestycje i ON i.id = t.inwestycja_id
    LEFT JOIN osoby o ON o.id = t.osoba_id
    LEFT JOIN leady l ON l.id = t.lead_id WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  res.json({
    id_tematu: t.identyfikator, kontrahent: t.klient_nazwa, nip: t.nip, branza: t.klient_branza,
    opiekun: t.handlowiec, sposob_pozyskania: t.sposob_pozyskania, zrodlo_wiedzy_wpip: t.zrodlo_wiedzy_wpip,
    inwestycja: t.inwestycja_nazwa, lokalizacja: [t.inwestycja_miasto, t.wojewodztwo].filter(Boolean).join(', '),
    wartosc_inwestycji: t.wartosc_inwestycji, wartosc_kontraktu: t.wartosc_kontraktu, model_realizacji: t.model_realizacji,
    etap: t.etap_projektu, osoba_decyzyjna: t.osoba_nazwa, stanowisko: t.stanowisko, email: t.email, telefon: t.telefon,
    scoring: t.score_total ? `${t.score_total} pkt (priorytet ${t.priorytet})` : null,
  });
});

// ---------- STATUS ZWROTNY E2E (temat lustrem procesu ofertowego w Intense) ----------
api.post('/tematy/:id/status-e2e', (req, res) => {
  const { status_e2e, wartosc_oferty, data_decyzji, powod } = req.body;
  const t = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie znaleziono tematu' });
  db.prepare(`UPDATE tematy SET status_e2e = COALESCE(?, status_e2e), wartosc_oferty = COALESCE(?, wartosc_oferty),
    data_decyzji_zwrotnej = COALESCE(?, data_decyzji_zwrotnej), powod_zwrotny = COALESCE(?, powod_zwrotny) WHERE id = ?`)
    .run(status_e2e || null, wartosc_oferty ?? null, data_decyzji || null, powod || null, t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'status E2E (Intense)', t.status_e2e || '—', status_e2e || t.status_e2e,
      [wartosc_oferty ? `oferta ${wartosc_oferty} mln` : null, powod].filter(Boolean).join(' · ') || 'Aktualizacja ręczna statusu zwrotnego');
  res.json({ ok: true });
});

// ---------- PROGNOZA SPRZEDAZY ----------
// Zalozenia konwersji z baseline 2025 (192 leady -> 57 ofert -> 14 wygranych, sr. kontrakt 25 mln).
const ZAL = { bid_rate: 0.30, win_rate: 0.25, sr_kontrakt: 25, sr_marza: 9 };

api.get('/prognoza', (req, res) => {
  // --- Lejek konwersji (aktywne leady wg kamienia + dalsze etapy) ---
  const wgKamienia = Object.fromEntries(
    db.prepare(`SELECT kamien, COUNT(*) c FROM leady WHERE status = 'aktywny' GROUP BY kamien`).all().map(r => [r.kamien, r.c]));
  const interesujace = db.prepare(`SELECT COUNT(*) c FROM leady WHERE status = 'aktywny' AND kwalif_wynik = 'interesujący'`).get().c;
  const wKolejceKomitetu = db.prepare(`SELECT COUNT(*) c FROM leady WHERE kamien = 'Zakwalifikowany' AND status = 'aktywny' AND temat_id IS NULL`).get().c;

  const tematyOtwarte = db.prepare(`SELECT * FROM tematy WHERE status = 'otwarty'`).all();
  const tematyWygrane = db.prepare(`SELECT * FROM tematy WHERE status = 'wygrany'`).all();
  const przegrane = db.prepare(`SELECT COUNT(*) c FROM tematy WHERE status = 'przegrany'`).get().c;

  const lejek = [
    { etap: 'Leady aktywne', liczba: Object.values(wgKamienia).reduce((s, c) => s + c, 0) },
    { etap: 'Po kwalifikacji wstępnej', liczba: (wgKamienia['Kwalifikacja wstępna'] || 0) + (wgKamienia['Research'] || 0) + (wgKamienia['Scoring'] || 0) + (wgKamienia['Zakwalifikowany'] || 0) },
    { etap: 'Interesujące', liczba: interesujace },
    { etap: 'W kolejce Komitetu', liczba: wKolejceKomitetu },
    { etap: 'W pipeline (tematy)', liczba: tematyOtwarte.length },
    { etap: 'Wygrane', liczba: tematyWygrane.length },
  ];

  // --- Prognoza pipeline wazona po kwartalach ---
  const kwartaly = {};
  for (const t of tematyOtwarte) {
    const start = t.termin_realizacji || t.data_startu;
    if (!start || !t.wartosc_kontraktu || !t.czas_trwania_mies) continue;
    const d0 = new Date(start); if (isNaN(d0)) continue;
    const naMies = t.wartosc_kontraktu / t.czas_trwania_mies;
    for (let m = 0; m < t.czas_trwania_mies; m++) {
      const dd = new Date(d0.getFullYear(), d0.getMonth() + m, 1);
      const q = `${dd.getFullYear()} Q${Math.floor(dd.getMonth() / 3) + 1}`;
      kwartaly[q] ||= { kwartal: q, planowany: 0, wazony: 0 };
      kwartaly[q].planowany += naMies;
      kwartaly[q].wazony += naMies * (t.prawdopodobienstwo || 0) / 100;
    }
  }
  const wartoscWazona = tematyOtwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0) * (t.prawdopodobienstwo || 0) / 100, 0);
  const wartoscPipeline = tematyOtwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0), 0);

  // --- Potencjal New Business z lejka (szacunek wg konwersji baseline) ---
  const oczekiwaneTematy = Math.round(interesujace * ZAL.bid_rate);
  const oczekiwaneWygrane = +(interesujace * ZAL.bid_rate * ZAL.win_rate).toFixed(1);
  const oczekiwanyPrzychodNB = +(oczekiwaneWygrane * ZAL.sr_kontrakt).toFixed(1);
  const oczekiwanaMarzaNB = +(oczekiwanyPrzychodNB * ZAL.sr_marza / 100).toFixed(1);

  res.json({
    zalozenia: ZAL,
    lejek,
    kwartaly: Object.values(kwartaly).sort((a, b) => a.kwartal.localeCompare(b.kwartal)),
    pipeline: {
      tematy: tematyOtwarte.length, wartosc: wartoscPipeline, wazona: wartoscWazona,
      wygrane: tematyWygrane.length, przegrane,
      marza_wazona: +(wartoscWazona * ZAL.sr_marza / 100).toFixed(1),
    },
    nowy_biznes: {
      interesujace, oczekiwane_tematy: oczekiwaneTematy, oczekiwane_wygrane: oczekiwaneWygrane,
      oczekiwany_przychod: oczekiwanyPrzychodNB, oczekiwana_marza: oczekiwanaMarzaNB,
    },
    prognoza_laczna: +(wartoscWazona + oczekiwanyPrzychodNB).toFixed(1),
  });
});

// ---------- CELE SPRZEDAZOWE (per handlowiec i okres) ----------
function zakresOkresu(okres) {
  // '2026Q3' -> [2026-07-01, 2026-10-01); '2026' -> caly rok
  const q = String(okres).match(/^(\d{4})Q([1-4])$/);
  if (q) {
    const rok = Number(q[1]), kw = Number(q[2]);
    const od = `${rok}-${String((kw - 1) * 3 + 1).padStart(2, '0')}-01`;
    const doM = kw === 4 ? `${rok + 1}-01-01` : `${rok}-${String(kw * 3 + 1).padStart(2, '0')}-01`;
    return [od, doM];
  }
  const r = String(okres).match(/^(\d{4})$/);
  if (r) return [`${r[1]}-01-01`, `${Number(r[1]) + 1}-01-01`];
  return null;
}

api.get('/cele', (req, res) => {
  res.json(db.prepare('SELECT * FROM cele WHERE aktywny = 1 ORDER BY okres DESC, handlowiec').all());
});
api.post('/cele', (req, res) => {
  const { okres, handlowiec, przychod_wazony, marza, wygrane, tematy_komitet, sprzedaz, notatka } = req.body;
  if (!okres || !zakresOkresu(okres)) return res.status(400).json({ error: 'Okres w formacie 2026Q3 lub 2026' });
  if (!handlowiec) return res.status(400).json({ error: 'Handlowiec jest wymagany' });
  const r = db.prepare('INSERT INTO cele (okres, handlowiec, przychod_wazony, marza, wygrane, tematy_komitet, sprzedaz, notatka) VALUES (?,?,?,?,?,?,?,?)')
    .run(okres, handlowiec, przychod_wazony ?? null, marza ?? null, wygrane ?? null, tematy_komitet ?? null, sprzedaz ?? null, notatka || null);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/cele/:id', (req, res) => {
  updateById('cele', req.params.id, pick(req.body, ['okres', 'handlowiec', 'przychod_wazony', 'marza', 'wygrane', 'tematy_komitet', 'sprzedaz', 'notatka', 'aktywny']));
  res.json({ ok: true });
});
api.delete('/cele/:id', (req, res) => {
  db.prepare('UPDATE cele SET aktywny = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Postep wykonania celow: plan vs wykonanie per cel (przychod wazony z otwartego pipeline
// handlowca + wygrane/komitety w okresie z historii)
api.get('/cele/postep', (req, res) => {
  const cele = db.prepare('SELECT * FROM cele WHERE aktywny = 1 ORDER BY okres DESC, handlowiec').all();
  const wynik = [];
  for (const c of cele) {
    const [od, doD] = zakresOkresu(c.okres) || [null, null];
    const otwarte = db.prepare(`SELECT COALESCE(SUM(wartosc_kontraktu * prawdopodobienstwo / 100.0), 0) w,
      COALESCE(SUM(wartosc_kontraktu * prawdopodobienstwo / 100.0 * COALESCE(marza_pct, 9) / 100.0), 0) m
      FROM tematy WHERE status = 'otwarty' AND handlowiec = ?`).get(c.handlowiec);
    const wygraneOkres = od ? db.prepare(`SELECT COUNT(DISTINCT t.id) c,
        COALESCE(SUM(t.wartosc_kontraktu), 0) w
      FROM tematy t JOIN historia_tematu h ON h.temat_id = t.id
      WHERE t.status = 'wygrany' AND t.handlowiec = ?
        AND (h.typ_zmiany = 'zamkniecie' OR h.typ_zmiany = 'potwierdzenie kamienia')
        AND (h.wartosc_po = 'wygrany' OR h.wartosc_po LIKE '%100%')
        AND h.data >= ? AND h.data < ?`).get(c.handlowiec, od, doD) : { c: 0, w: 0 };
    const komitetOkres = od ? db.prepare(`SELECT COUNT(DISTINCT pk.temat_id) c
      FROM potwierdzenia_kamieni pk
      JOIN kamienie_karty km ON km.id = pk.kamien_id
      JOIN tematy t ON t.id = pk.temat_id
      WHERE km.kod IN ('M5','F3') AND t.handlowiec = ? AND pk.data >= ? AND pk.data < ?`).get(c.handlowiec, od, doD) : { c: 0 };
    wynik.push({
      ...c,
      wykonanie: {
        przychod_wazony: +otwarte.w.toFixed(1),
        marza: +otwarte.m.toFixed(2),
        wygrane: wygraneOkres.c,
        wygrane_wartosc: +Number(wygraneOkres.w).toFixed(1),
        tematy_komitet: komitetOkres.c,
      },
    });
  }
  res.json(wynik);
});

// ---------- PLAN WYNIKOWY: "na co idziemy" + odwrocony lejek z konwersji ----------
// Cotygodniowa kontrola: projekcja wyniku przy aktualnych postepach, luka do planu
// i wyliczenie wstecz (przez zmierzone konwersje), ile potrzeba lead/kwalifikacji/
// tematow/komitetow/dzialan - lacznie i tygodniowo.

const FALLBACK_KONWERSJI = { lead_interesujacy: .55, interesujacy_temat: .30, temat_komitet: .45, komitet_wygrana: .25 };
const MIN_PROBA = 8; // ponizej tylu obserwacji uzywamy fallbacku, nie pomiaru

function konwersjaZmierzona(licznik, mianownik, fallback) {
  // Pomiar wymaga sensownej proby PO OBU stronach ulamka - inaczej baseline
  // (np. tematy z importu arkusza nie maja lead_id, wiec licznik lead->temat bylby sztucznie niski)
  if (!mianownik || mianownik < MIN_PROBA || licznik < 5) return { wartosc: fallback, zrodlo: 'baseline' };
  return { wartosc: Math.max(0.01, licznik / mianownik), zrodlo: 'pomiar' };
}

function policzPlanWynikowy(okres) {
  const [od, doD] = zakresOkresu(okres) || [];
  if (!od) throw new Error('Okres w formacie 2026 lub 2026Q3');
  const dzis = new Date();
  const koniec = new Date(doD + 'T00:00:00Z');
  const tygodniePozostale = Math.max(1, Math.round((koniec - dzis) / (7 * 86400000)));
  const miesiacePozostale = Math.max(0.5, +((koniec - dzis) / (30.44 * 86400000)).toFixed(1));

  // Plan: firmowy z konfiguracji (fallback: suma celow sprzedazy), per handlowiec z celow
  const rok = String(okres).slice(0, 4);
  const planKonf = db.prepare(`SELECT wartosc FROM konfiguracja WHERE klucz = ?`).get('plan_sprzedazy_' + rok);
  const cele = db.prepare(`SELECT * FROM cele WHERE okres = ? AND aktywny = 1 AND sprzedaz IS NOT NULL`).all(rok);
  const planFirmowy = planKonf ? Number(planKonf.wartosc) : cele.reduce((s, c) => s + (c.sprzedaz || 0), 0);

  // Wygrane w okresie (wartosc + liczba), takze per handlowiec
  const wygrane = db.prepare(`
    SELECT t.handlowiec, COUNT(DISTINCT t.id) n, COALESCE(SUM(t.wartosc_kontraktu), 0) w
    FROM tematy t JOIN historia_tematu h ON h.temat_id = t.id
    WHERE t.status = 'wygrany' AND h.wartosc_po = 'wygrany' AND h.data >= ? AND h.data < ?
    GROUP BY t.handlowiec`).all(od, doD);
  const wygraneRazem = { n: wygrane.reduce((s, r) => s + r.n, 0), w: +wygrane.reduce((s, r) => s + r.w, 0).toFixed(1) };
  const srWartoscWygranej = wygraneRazem.n >= 3 ? wygraneRazem.w / wygraneRazem.n : 25; // baseline 25 mln

  // Otwarty pipeline (wazony), takze per handlowiec
  const otwarte = db.prepare(`SELECT handlowiec, COUNT(*) n,
      COALESCE(SUM(wartosc_kontraktu * prawdopodobienstwo / 100.0), 0) w
    FROM tematy WHERE status = 'otwarty' GROUP BY handlowiec`).all();
  const wazonyRazem = +otwarte.reduce((s, r) => s + r.w, 0).toFixed(1);
  const tematyOtwarteRazem = otwarte.reduce((s, r) => s + r.n, 0);

  // Projekcja: zakontraktowane + wazony pipeline; luka do planu
  const projekcja = +(wygraneRazem.w + wazonyRazem).toFixed(1);
  const luka = Math.max(0, +(planFirmowy - projekcja).toFixed(1));

  // ── Konwersje poziomow procesu (pomiar z danych, fallback: baseline) ──
  const leadyStat = db.prepare(`SELECT COUNT(*) all_l,
      SUM(CASE WHEN kwalif_wynik = 'interesujący' THEN 1 ELSE 0 END) inter,
      SUM(CASE WHEN temat_id IS NOT NULL THEN 1 ELSE 0 END) z_tematem
    FROM leady`).get();
  const tematyAll = db.prepare(`SELECT COUNT(*) c FROM tematy`).get().c;
  const komitetyAll = db.prepare(`SELECT COUNT(DISTINCT pk.temat_id) c FROM potwierdzenia_kamieni pk
    JOIN kamienie_karty km ON km.id = pk.kamien_id WHERE km.kod IN ('M5','P5','K8','F3')`).get().c;
  const wygraneAll = db.prepare(`SELECT COUNT(*) c FROM tematy WHERE status = 'wygrany'`).get().c;

  const konw = {
    lead_interesujacy: konwersjaZmierzona(leadyStat.inter, leadyStat.all_l, FALLBACK_KONWERSJI.lead_interesujacy),
    interesujacy_temat: konwersjaZmierzona(leadyStat.z_tematem, leadyStat.inter, FALLBACK_KONWERSJI.interesujacy_temat),
    temat_komitet: konwersjaZmierzona(komitetyAll, tematyAll, FALLBACK_KONWERSJI.temat_komitet),
    komitet_wygrana: konwersjaZmierzona(wygraneAll, komitetyAll, FALLBACK_KONWERSJI.komitet_wygrana),
  };

  // ── Odwrocony lejek: od luki wstecz do leadow ──
  const potrzebneWygrane = Math.ceil(luka / srWartoscWygranej);
  const potrzebneKomitety = Math.ceil(potrzebneWygrane / konw.komitet_wygrana.wartosc);
  const potrzebneTematy = Math.ceil(potrzebneKomitety / konw.temat_komitet.wartosc);
  const potrzebneInteresujace = Math.ceil(potrzebneTematy / konw.interesujacy_temat.wartosc);
  const potrzebneLeady = Math.ceil(potrzebneInteresujace / konw.lead_interesujacy.wartosc);

  // Ile "jest" na poziomach teraz (zasoby w toku)
  const jest = {
    leady: db.prepare(`SELECT COUNT(*) c FROM leady WHERE status = 'aktywny'`).get().c,
    interesujace: db.prepare(`SELECT COUNT(*) c FROM leady WHERE status = 'aktywny' AND kwalif_wynik = 'interesujący'`).get().c,
    tematy: tematyOtwarteRazem,
    komitety_w_okresie: db.prepare(`SELECT COUNT(DISTINCT pk.temat_id) c FROM potwierdzenia_kamieni pk
      JOIN kamienie_karty km ON km.id = pk.kamien_id
      WHERE km.kod IN ('M5','P5','K8','F3') AND pk.data >= ? AND pk.data < ?`).get(od, doD).c,
    wygrane_w_okresie: wygraneRazem.n,
  };

  // ── Dzialania: srednio wykonanych dzialan na wygrany temat (fallback 12) ──
  const dzialNaWygrana = db.prepare(`SELECT COUNT(*) c FROM dzialania d
    JOIN tematy t ON t.id = d.temat_id WHERE t.status = 'wygrany' AND d.status = 'wykonane'`).get().c;
  const srDzialan = wygraneAll >= 3 ? Math.max(3, Math.round(dzialNaWygrana / wygraneAll)) : 12;
  const potrzebneDzialania = potrzebneWygrane * srDzialan;

  // Velocity: potrzebna vs aktualna (mln/mc)
  const velocityAktualna = policzMetryki().velocity.mln_na_miesiac;
  const velocityPotrzebna = +(luka / miesiacePozostale).toFixed(1);

  // ── Biezacy tydzien: wymagane tempo vs faktyczne wykonanie (od poniedzialku) ──
  const teraz = new Date();
  const pon = new Date(teraz);
  pon.setDate(teraz.getDate() - ((teraz.getDay() + 6) % 7));
  const poniedzialek = pon.toISOString().slice(0, 10);

  const wykonanieTygodnia = {
    nowe_leady: db.prepare(`SELECT COUNT(*) c FROM leady WHERE utworzono >= ?`).get(poniedzialek).c,
    kwalifikacje: db.prepare(`SELECT COUNT(DISTINCT lead_id) c FROM historia_leada
      WHERE typ_zmiany LIKE 'kwalifikacja%' AND data >= ?`).get(poniedzialek).c,
    dzialania_wykonane: db.prepare(`SELECT COUNT(*) c FROM dzialania WHERE status = 'wykonane'
      AND COALESCE(data_wykonania, termin, utworzono) >= ?`).get(poniedzialek).c,
    dzialania_zaplanowane: db.prepare(`SELECT COUNT(*) c FROM dzialania WHERE status = 'planowane'
      AND termin IS NOT NULL AND termin >= ? AND termin < date(?, '+7 days')`).get(poniedzialek, poniedzialek).c,
    komitety: db.prepare(`SELECT COUNT(DISTINCT pk.temat_id) c FROM potwierdzenia_kamieni pk
      JOIN kamienie_karty km ON km.id = pk.kamien_id
      WHERE km.kod IN ('M5','P5','K8','F3') AND pk.data >= ?`).get(poniedzialek).c,
    wygrane: db.prepare(`SELECT COUNT(DISTINCT t.id) c FROM tematy t JOIN historia_tematu h ON h.temat_id = t.id
      WHERE t.status = 'wygrany' AND h.wartosc_po = 'wygrany' AND h.data >= ?`).get(poniedzialek).c,
  };
  const tydzienPlanVsWykonanie = [
    { poziom: 'Nowe leady', wymagane: +(potrzebneLeady / tygodniePozostale).toFixed(1), zrobione: wykonanieTygodnia.nowe_leady },
    { poziom: 'Kwalifikacje', wymagane: +(potrzebneInteresujace / tygodniePozostale).toFixed(1), zrobione: wykonanieTygodnia.kwalifikacje },
    { poziom: 'Działania', wymagane: +(potrzebneDzialania / tygodniePozostale).toFixed(1), zrobione: wykonanieTygodnia.dzialania_wykonane, zaplanowane: wykonanieTygodnia.dzialania_zaplanowane },
    { poziom: 'Komitety (BID)', wymagane: +(potrzebneKomitety / tygodniePozostale).toFixed(1), zrobione: wykonanieTygodnia.komitety },
    { poziom: 'Wygrane', wymagane: +(potrzebneWygrane / tygodniePozostale).toFixed(1), zrobione: wykonanieTygodnia.wygrane },
  ];

  // Wykonanie tygodnia per handlowiec (dzialania przez temat/lead, leady wprost)
  const wykTydzHandlowca = (h) => ({
    dzialania: db.prepare(`SELECT COUNT(*) c FROM dzialania d
      LEFT JOIN tematy t ON t.id = d.temat_id LEFT JOIN leady l ON l.id = d.lead_id
      WHERE d.status = 'wykonane' AND COALESCE(d.data_wykonania, d.termin, d.utworzono) >= ?
      AND COALESCE(t.handlowiec, l.handlowiec) = ?`).get(poniedzialek, h).c,
    nowe_leady: db.prepare(`SELECT COUNT(*) c FROM leady WHERE utworzono >= ? AND handlowiec = ?`).get(poniedzialek, h).c,
  });

  // ── Per handlowiec (te same konwersje, cel z tabeli cele) ──
  const mapaWygranych = Object.fromEntries(wygrane.map(r => [r.handlowiec || '—', r]));
  const mapaOtwartych = Object.fromEntries(otwarte.map(r => [r.handlowiec || '—', r]));
  const handlowcy = cele.map(c => {
    const wyg = mapaWygranych[c.handlowiec] || { n: 0, w: 0 };
    const otw = mapaOtwartych[c.handlowiec] || { n: 0, w: 0 };
    const projekcjaH = +(wyg.w + otw.w).toFixed(1);
    const lukaH = Math.max(0, +((c.sprzedaz || 0) - projekcjaH).toFixed(1));
    const wygraneH = Math.ceil(lukaH / srWartoscWygranej);
    const leadyH = Math.ceil(wygraneH / (konw.komitet_wygrana.wartosc * konw.temat_komitet.wartosc
      * konw.interesujacy_temat.wartosc * konw.lead_interesujacy.wartosc));
    const wykT = wykTydzHandlowca(c.handlowiec);
    return {
      handlowiec: c.handlowiec, plan: c.sprzedaz, wygrane_wartosc: +wyg.w.toFixed(1), wygrane_n: wyg.n,
      wazony: +otw.w.toFixed(1), tematy_otwarte: otw.n, projekcja: projekcjaH, luka: lukaH,
      potrzebne_wygrane: wygraneH,
      potrzebne_leady_tydz: +(leadyH / tygodniePozostale).toFixed(1),
      potrzebne_dzialania_tydz: +(wygraneH * srDzialan / tygodniePozostale).toFixed(1),
      tydzien_dzialania: wykT.dzialania, tydzien_leady: wykT.nowe_leady,
    };
  });

  return {
    okres, od, do: doD, tygodnie_pozostale: tygodniePozostale, miesiace_pozostale: miesiacePozostale,
    plan_firmowy: planFirmowy, wygrane: wygraneRazem, wazony: wazonyRazem,
    projekcja, luka, sr_wartosc_wygranej: +srWartoscWygranej.toFixed(1),
    velocity: { aktualna: velocityAktualna, potrzebna: velocityPotrzebna },
    konwersje: konw,
    tydzien: { od: poniedzialek, pozycje: tydzienPlanVsWykonanie },
    lejek_odwrocony: [
      { poziom: 'Nowe leady', potrzeba: potrzebneLeady, tygodniowo: +(potrzebneLeady / tygodniePozostale).toFixed(1), jest: jest.leady, konwersja: konw.lead_interesujacy },
      { poziom: 'Kwalifikacje (interesujące)', potrzeba: potrzebneInteresujace, tygodniowo: +(potrzebneInteresujace / tygodniePozostale).toFixed(1), jest: jest.interesujace, konwersja: konw.interesujacy_temat },
      { poziom: 'Tematy w pipeline', potrzeba: potrzebneTematy, tygodniowo: +(potrzebneTematy / tygodniePozostale).toFixed(1), jest: jest.tematy, konwersja: konw.temat_komitet },
      { poziom: 'Komitety (BID)', potrzeba: potrzebneKomitety, tygodniowo: +(potrzebneKomitety / tygodniePozostale).toFixed(1), jest: jest.komitety_w_okresie, konwersja: konw.komitet_wygrana },
      { poziom: 'Wygrane', potrzeba: potrzebneWygrane, tygodniowo: +(potrzebneWygrane / tygodniePozostale).toFixed(1), jest: jest.wygrane_w_okresie, konwersja: null },
    ],
    dzialania: { srednio_na_wygrana: srDzialan, potrzeba: potrzebneDzialania, tygodniowo: +(potrzebneDzialania / tygodniePozostale).toFixed(1) },
    handlowcy,
  };
}

api.get('/plan-wynikowy', (req, res) => {
  const okres = req.query.okres || String(new Date().getFullYear());
  res.json(policzPlanWynikowy(okres));
});

// ---------- KAMPANIE: testowanie hipotez segmentowych ----------
// Pelny obiekt: hipoteza + segment + zrodlo + okres + cele; lejek konwersji
// liczony z przypisanych leadow (lead -> interesujacy -> temat -> komitet -> wygrana).
const KAMPANIA_POLA = ['nazwa', 'hipoteza', 'segment', 'zrodlo', 'data_od', 'data_do',
  'cel_leadow', 'cel_tematow', 'status', 'werdykt_uzasadnienie', 'notatki'];

function lejekKampanii(kampaniaId) {
  return db.prepare(`SELECT COUNT(*) leady,
      SUM(CASE WHEN l.kwalif_wynik = 'interesujący' THEN 1 ELSE 0 END) interesujace,
      SUM(CASE WHEN l.temat_id IS NOT NULL THEN 1 ELSE 0 END) tematy,
      SUM(CASE WHEN l.temat_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM potwierdzenia_kamieni pk JOIN kamienie_karty pkk ON pkk.id = pk.kamien_id
        WHERE pk.temat_id = l.temat_id AND pkk.kod IN ('M5','P5','K8','F3')) THEN 1 ELSE 0 END) komitety,
      SUM(CASE WHEN l.temat_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM tematy t WHERE t.id = l.temat_id AND t.status = 'wygrany') THEN 1 ELSE 0 END) wygrane
    FROM leady l WHERE l.kampania_id = ?`).get(kampaniaId);
}

api.get('/kampanie', (req, res) => {
  const kampanie = db.prepare('SELECT * FROM kampanie ORDER BY data_od DESC, id DESC').all();
  for (const k of kampanie) k.lejek = lejekKampanii(k.id);
  res.json(kampanie);
});
api.post('/kampanie', (req, res) => {
  const d = pick(req.body, KAMPANIA_POLA);
  if (!d.nazwa) return res.status(400).json({ error: 'Nazwa kampanii jest wymagana' });
  if (!d.hipoteza) return res.status(400).json({ error: 'Kampania testuje hipotezę — wpisz ją' });
  const keys = Object.keys(d);
  const r = db.prepare(`INSERT INTO kampanie (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => d[k]));
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/kampanie/:id', (req, res) => {
  updateById('kampanie', req.params.id, pick(req.body, KAMPANIA_POLA));
  res.json({ ok: true });
});
api.delete('/kampanie/:id', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM leady WHERE kampania_id = ?').get(req.params.id).c;
  if (n > 0) return res.status(400).json({ error: `Kampania ma ${n} przypisanych leadów — najpierw je odepnij` });
  db.prepare('DELETE FROM kampanie WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
// Masowe przypisanie leadow do kampanii (np. swiezo zaimportowana partia)
api.post('/kampanie/:id/przypisz', (req, res) => {
  const { lead_ids = [] } = req.body;
  const upd = db.prepare('UPDATE leady SET kampania_id = ? WHERE id = ?');
  for (const lid of lead_ids) upd.run(req.params.id, lid);
  res.json({ ok: true, przypisano: lead_ids.length });
});

// ---------- SILNIK SPRZEDAZY: graficzny model trybikow ----------
// Obie warstwy jako jeden mechanizm: zrodla -> prospecting -> kwalifikacja ->
// lejek NB -> Komitet (BID) -> ofertowanie -> wynik. Kazdy trybik ma stan,
// tygodniowe wymagane vs zrobione (z planu wynikowego) i konwersje na wyjsciu.
// Najslabszy trybik tygodnia = waskie gardlo obnizajace prognoze.
api.get('/silnik', (req, res) => {
  const okres = req.query.okres || String(new Date().getFullYear());
  const plan = policzPlanWynikowy(okres);
  const poz = Object.fromEntries(plan.tydzien.pozycje.map(p => [p.poziom, p]));
  const lejek = Object.fromEntries(plan.lejek_odwrocony.map(p => [p.poziom, p]));

  // Zrodla pozyskania: naplyw leadow 30 dni + aktywne w toku
  const zrodla = db.prepare(`SELECT COALESCE(NULLIF(TRIM(zrodlo), ''), 'nieznane') zrodlo,
      COUNT(*) razem,
      SUM(CASE WHEN status = 'aktywny' THEN 1 ELSE 0 END) aktywne,
      SUM(CASE WHEN utworzono >= date('now', '-30 days') THEN 1 ELSE 0 END) ostatnie_30d
    FROM leady GROUP BY 1 ORDER BY razem DESC`).all();

  // Ofertowanie (warstwa Pipeline): otwarte tematy PO bramce komitetu
  const ofertowanie = db.prepare(`SELECT COUNT(*) n,
      COALESCE(SUM(wartosc_kontraktu), 0) suma,
      COALESCE(SUM(wartosc_kontraktu * prawdopodobienstwo / 100.0), 0) wazona
    FROM tematy t WHERE t.status = 'otwarty'
      AND EXISTS (SELECT 1 FROM potwierdzenia_kamieni pk JOIN kamienie_karty pkk ON pkk.id = pk.kamien_id
        WHERE pk.temat_id = t.id AND pkk.kod IN ('M5','P5','K8','F3'))`).get();
  const kolejkaKomitetu = db.prepare(`SELECT COUNT(*) c FROM tematy t
    JOIN kamienie_karty km ON km.id = t.kamien_id
    WHERE t.status = 'otwarty' AND km.kod IN ('M5','P5','K8','F3')`).get().c;
  const tematyPrzed = db.prepare(`SELECT COUNT(*) c FROM tematy t WHERE t.status = 'otwarty'
    AND NOT EXISTS (SELECT 1 FROM potwierdzenia_kamieni pk JOIN kamienie_karty pkk ON pkk.id = pk.kamien_id
      WHERE pk.temat_id = t.id AND pkk.kod IN ('M5','P5','K8','F3'))`).get().c;

  // Wartosc jednostki na kazdym poziomie: sr. wygrana x konwersje w dol lejka
  const k = plan.konwersje;
  const w = plan.sr_wartosc_wygranej;
  const wartoscJednostki = {
    lead: +(w * k.komitet_wygrana.wartosc * k.temat_komitet.wartosc * k.interesujacy_temat.wartosc * k.lead_interesujacy.wartosc).toFixed(2),
    kwalifikacja: +(w * k.komitet_wygrana.wartosc * k.temat_komitet.wartosc * k.interesujacy_temat.wartosc).toFixed(2),
    komitet: +(w * k.komitet_wygrana.wartosc).toFixed(2),
    wygrana: w,
  };

  const trybik = (klucz, nazwa, warstwa, stan, tydz, konwersja, wartoscJedn) => {
    const wymagane = tydz ? tydz.wymagane : null;
    const zrobione = tydz ? tydz.zrobione : null;
    const kondycja = wymagane > 0 ? Math.min(1.5, zrobione / wymagane) : null;
    return { klucz, nazwa, warstwa, stan, wymagane, zrobione,
      zaplanowane: tydz?.zaplanowane ?? null,
      kondycja: kondycja == null ? null : +kondycja.toFixed(2),
      konwersja, wartosc_jednostki: wartoscJedn ?? null };
  };

  const trybiki = [
    trybik('leady', 'Prospecting / nowe leady', 'nb',
      { etykieta: 'aktywne leady', liczba: lejek['Nowe leady'].jest },
      poz['Nowe leady'], k.lead_interesujacy, wartoscJednostki.lead),
    trybik('kwalifikacja', 'Kwalifikacja i scoring', 'nb',
      { etykieta: 'interesujące', liczba: lejek['Kwalifikacje (interesujące)'].jest },
      poz['Kwalifikacje'], k.interesujacy_temat, wartoscJednostki.kwalifikacja),
    trybik('lejek_nb', 'Lejek NB — tematy przed Komitetem', 'nb',
      { etykieta: 'tematy w pracy', liczba: tematyPrzed },
      poz['Działania'], k.temat_komitet, null),
    trybik('komitet', 'Komitet Ofertowy (BID)', 'nb',
      { etykieta: 'w kolejce', liczba: kolejkaKomitetu },
      poz['Komitety (BID)'], k.komitet_wygrana, wartoscJednostki.komitet),
    trybik('ofertowanie', 'Ofertowanie — Pipeline', 'pipeline',
      { etykieta: 'tematy po BID', liczba: ofertowanie.n, wazona: +ofertowanie.wazona.toFixed(1) },
      poz['Wygrane'], null, wartoscJednostki.wygrana),
  ];

  // Waskie gardlo: najnizsza kondycja sposrod trybikow z wymaganym tempem;
  // wplyw = brakujace jednostki w tym tygodniu x wartosc jednostki
  let waskieGardlo = null;
  for (const t of trybiki) {
    if (t.kondycja == null) continue;
    if (!waskieGardlo || t.kondycja < waskieGardlo.kondycja) waskieGardlo = t;
  }
  if (waskieGardlo && waskieGardlo.kondycja < 1) {
    const brak = Math.max(0, waskieGardlo.wymagane - waskieGardlo.zrobione);
    waskieGardlo = { klucz: waskieGardlo.klucz, nazwa: waskieGardlo.nazwa, kondycja: waskieGardlo.kondycja,
      brak_tydzien: +brak.toFixed(1),
      wplyw_mln: waskieGardlo.wartosc_jednostki ? +(brak * waskieGardlo.wartosc_jednostki).toFixed(1) : null };
  } else waskieGardlo = null;

  res.json({
    okres, tydzien_od: plan.tydzien.od,
    plan: plan.plan_firmowy, projekcja: plan.projekcja, luka: plan.luka,
    wygrane: plan.wygrane, wazony: plan.wazony,
    velocity: plan.velocity, sr_wartosc_wygranej: plan.sr_wartosc_wygranej,
    zrodla, trybiki, waskie_gardlo: waskieGardlo,
    ofertowanie: { n: ofertowanie.n, suma: +ofertowanie.suma.toFixed(1), wazona: +ofertowanie.wazona.toFixed(1) },
  });
});

api.put('/plan-wynikowy', (req, res) => {
  const { rok, plan } = req.body;
  if (!rok || !plan) return res.status(400).json({ error: 'Podaj rok i plan (mln PLN)' });
  db.prepare(`INSERT OR REPLACE INTO konfiguracja (klucz, wartosc) VALUES (?, ?)`)
    .run('plan_sprzedazy_' + rok, String(plan));
  res.json({ ok: true });
});

// ---------- METRYKI PIPELINE (dashboard v2) ----------
function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Metryki pipeline. Wydzielone z trasy, bo karta PDCA pokazuje je razem
// z kontrola dzialan — jedno zrodlo liczb dla obu.
function policzMetryki() {
  sprawdzRecykling();

  // Wejscia w kamienie (do lejka konwersji i czasu w etapie)
  const wejscia = db.prepare(`
    SELECT mw.temat_id, mw.data_wejscia, km.kod, km.kolejnosc, kr.kod AS pipeline_kod, kr.nazwa AS pipeline_nazwa
    FROM milestone_wejscia mw
    JOIN kamienie_karty km ON km.id = mw.kamien_id
    JOIN karty_ratingu kr ON kr.id = km.karta_id
    ORDER BY mw.temat_id, mw.data_wejscia`).all();

  // Lejek: distinct tematy ktore weszly w dany kamien (per pipeline, kolejnosc)
  const lejekMap = {};      // pipeline_kod -> kod -> {kolejnosc, nazwa_pipe, tematy:Set}
  const czasyEtapu = {};    // kod -> [dni]
  const perTemat = {};      // temat_id -> [{kod, data, kolejnosc}]
  for (const w of wejscia) {
    (lejekMap[w.pipeline_kod] ||= {});
    (lejekMap[w.pipeline_kod][w.kod] ||= { kolejnosc: w.kolejnosc, pipeline: w.pipeline_nazwa, tematy: new Set() }).tematy.add(w.temat_id);
    (perTemat[w.temat_id] ||= []).push({ kod: w.kod, data: w.data_wejscia, kolejnosc: w.kolejnosc });
  }
  // Czas w etapie z kolejnych wejsc tego samego tematu (zakonczone etapy)
  for (const [, lista] of Object.entries(perTemat)) {
    lista.sort((a, b) => a.data.localeCompare(b.data));
    for (let i = 0; i < lista.length - 1; i++) {
      const dni = Math.round((new Date(lista[i + 1].data + 'Z') - new Date(lista[i].data + 'Z')) / 86400000);
      if (dni >= 0) (czasyEtapu[lista[i].kod] ||= []).push(dni);
    }
  }
  const lejek = Object.entries(lejekMap).map(([pipe, kody]) => ({
    pipeline: pipe,
    etapy: Object.entries(kody).sort((a, b) => a[1].kolejnosc - b[1].kolejnosc).map(([kod, v], i, arr) => {
      const liczba = v.tematy.size;
      const poprz = i > 0 ? arr[i - 1][1].tematy.size : null;
      return { kod, liczba, konwersja: poprz ? Math.round(100 * liczba / poprz) : null, mediana_dni: mediana(czasyEtapu[kod] || []) };
    }),
  }));

  // Rozklad powodow utraty per etap (na ktorym kamieniu temat sie zamknal)
  const utrata = db.prepare(`
    SELECT km.kod AS kamien_kod, t.przyczyna_zamkniecia AS powod, t.status, COUNT(*) c
    FROM tematy t LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    WHERE t.status IN ('przegrany', 'odrzucony', 'recycled')
    GROUP BY km.kod, t.przyczyna_zamkniecia, t.status ORDER BY c DESC`).all();

  // Skutecznosc typow zadan (ktore typy najczesciej maja efekt osiagniety)
  const zadania = db.prepare(`
    SELECT typ, COUNT(*) total,
      SUM(CASE WHEN wynik = 'Osiągnięty' THEN 1 ELSE 0 END) osiagniete
    FROM dzialania WHERE status = 'wykonane' AND wynik IS NOT NULL AND typ IS NOT NULL
    GROUP BY typ ORDER BY total DESC`).all();
  for (const z of zadania) z.skutecznosc = z.total ? Math.round(100 * z.osiagniete / z.total) : null;

  // Coverage Account Management (konta powracajace z planem opieki)
  const am = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN data_nastepnego_przegladu IS NOT NULL THEN 1 ELSE 0 END) z_planem,
    SUM(CASE WHEN data_nastepnego_przegladu <= date('now') THEN 1 ELSE 0 END) zalegle
    FROM klienci WHERE klient_powracajacy = 1`).get();

  // Sales velocity = (liczba otwartych x sr. wartosc x win rate) / sr. dlugosc cyklu (dni)
  const otwartePipe = db.prepare(`SELECT COUNT(*) c, COALESCE(AVG(wartosc_kontraktu), 0) sr FROM tematy WHERE status = 'otwarty'`).get();
  const wygrPrzegr = db.prepare(`SELECT
    SUM(CASE WHEN status = 'wygrany' THEN 1 ELSE 0 END) w,
    SUM(CASE WHEN status = 'przegrany' THEN 1 ELSE 0 END) p FROM tematy`).get();
  // Male proby daja absurdy (win rate 100%, cykl 1 dzien) - ponizej progow uzywamy baseline 2025
  const MIN_ZAMKNIETYCH = 5, MIN_CYKLI = 3;
  const zamknietych = wygrPrzegr.w + wygrPrzegr.p;
  const winRate = zamknietych >= MIN_ZAMKNIETYCH ? wygrPrzegr.w / zamknietych : 0.25; // baseline 2025
  const cykle = db.prepare(`SELECT t.utworzono, h.data FROM tematy t
    JOIN historia_tematu h ON h.temat_id = t.id
    WHERE t.status = 'wygrany' AND (h.typ_zmiany = 'zamkniecie' AND h.wartosc_po = 'wygrany')`).all()
    .map(r => Math.max(1, Math.round((new Date(r.data + 'Z') - new Date(r.utworzono + 'Z')) / 86400000)));
  const srCyklDni = cykle.length >= MIN_CYKLI
    ? Math.round(cykle.reduce((s, d) => s + d, 0) / cykle.length) : 365; // baseline: cykl ~12 mc
  const fallback = zamknietych < MIN_ZAMKNIETYCH || cykle.length < MIN_CYKLI;
  const velocity = srCyklDni > 0 ? +((otwartePipe.c * otwartePipe.sr * winRate) / srCyklDni * 30).toFixed(1) : null;

  return {
    lejek, utrata, zadania,
    velocity: {
      mln_na_miesiac: velocity, otwarte: otwartePipe.c, sr_wartosc: +otwartePipe.sr.toFixed(1),
      win_rate_pct: Math.round(winRate * 100), sr_cykl_dni: srCyklDni,
      fallback,
    },
    am_coverage: {
      konta: am.total || 0, z_planem: am.z_planem || 0, zalegle: am.zalegle || 0,
      pokrycie_pct: am.total ? Math.round(100 * (am.z_planem || 0) / am.total) : null,
    },
  };
}

api.get('/metryki', (req, res) => res.json(policzMetryki()));

// ---------- PDCA ----------
// Kontrola dzialan prowadzacych do kamieni milowych. Cztery fazy liczone
// z danych procesu, bez osobnego "modulu jakosci" do wypelniania recznie.

api.get('/pdca', (req, res) => {
  sprawdzRecykling();

  // Sciezki procesu z docelowa dlugoscia cyklu (suma norm kamieni)
  const sciezki = db.prepare(`SELECT kr.id, kr.kod, kr.nazwa, kr.persona,
      COALESCE(SUM(km.czas_typowy_dni), 0) AS norma_dni, COUNT(km.id) AS kamieni
    FROM karty_ratingu kr LEFT JOIN kamienie_karty km ON km.karta_id = kr.id
    WHERE kr.aktywna = 1 GROUP BY kr.id ORDER BY norma_dni`).all();
  for (const s of sciezki) {
    s.norma_mies = s.norma_dni ? +(s.norma_dni / 30.4).toFixed(1) : null;
    s.tematy = db.prepare(`SELECT COUNT(*) c FROM tematy WHERE karta_id = ? AND status = 'otwarty'`).get(s.id).c;
    s.kamienie = db.prepare(`SELECT kod, nazwa, czas_typowy_dni, prawd_start FROM kamienie_karty
      WHERE karta_id = ? ORDER BY kolejnosc`).all(s.id);
  }

  // Tematy otwarte z pelnym stanem PDCA
  const tematy = db.prepare(`SELECT t.*, k.nazwa AS klient_nazwa, km.kod AS kamien_kod,
      km.nazwa AS kamien_nazwa, kr.kod AS pipeline_kod, kr.nazwa AS pipeline_nazwa
    FROM tematy t
    LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    WHERE t.status = 'otwarty' ORDER BY t.wartosc_kontraktu DESC`).all();

  for (const t of tematy) {
    t.pdca = stanPdca(t);
    t.prognoza = prognozaPodpisania(t);
    t.zastygly = czyZastygly(t);
    t.bez_planu = !db.prepare(`SELECT 1 FROM dzialania WHERE temat_id = ? AND status = 'planowane' LIMIT 1`).get(t.id);
  }

  const licz = (f) => tematy.filter(f).length;
  const podsumowanie = {
    otwarte: tematy.length,
    w_normie: licz(t => t.pdca.czas.stan === 'w normie'),
    zagrozone: licz(t => t.pdca.czas.stan === 'zagrozony'),
    opoznione: licz(t => t.pdca.czas.stan === 'opozniony'),
    wymaga_decyzji: licz(t => t.pdca.wymaga_decyzji),
    bez_planu: licz(t => t.bez_planu),
    gotowe_do_potwierdzenia: licz(t => t.pdca.gotowy),
    // Ile lacznie kryteriow dzieli otwarte tematy od awansu — dosłowne "ile brakuje"
    brakujacych_kryteriow: tematy.reduce((s, t) => s + (t.pdca.check.kryteria_razem - t.pdca.check.kryteria_spelnione), 0),
    suma_opoznienia_dni: tematy.reduce((s, t) => s + (t.pdca.czas.przekroczenie || 0), 0),
  };

  // Kwalifikacja leada: norma narastajaco do biezacego etapu sciezki prospectingowej
  const normy = db.prepare(`SELECT wartosc, COALESCE(norma_dni, 0) norma, kolejnosc
    FROM slowniki WHERE typ = 'kamien_prospectingu' AND aktywny = 1 ORDER BY kolejnosc`).all();
  const narastajaco = {};
  let suma = 0;
  for (const n of normy) { suma += n.norma; narastajaco[n.wartosc] = suma; }

  const leadyAktywne = db.prepare(`SELECT l.id, l.nazwa, l.kamien, l.utworzono, l.priorytet, l.handlowiec,
      k.nazwa AS klient_nazwa
    FROM leady l LEFT JOIN klienci k ON k.id = l.klient_id
    WHERE l.status = 'aktywny' AND COALESCE(l.kamien,'') <> 'Zakwalifikowany'`).all();
  for (const l of leadyAktywne) {
    l.wiek_dni = Math.floor((Date.now() - new Date(l.utworzono + 'Z').getTime()) / 86400000);
    l.norma_dni = narastajaco[l.kamien] ?? suma;
    l.po_normie = l.wiek_dni > l.norma_dni;
  }
  leadyAktywne.sort((a, b) => (b.wiek_dni - b.norma_dni) - (a.wiek_dni - a.norma_dni));

  // Ostatnie decyzje korygujace — slad, ze cykl sie domyka
  const decyzje = db.prepare(`SELECT p.*, t.identyfikator, km.kod AS kamien_kod
    FROM pdca_decyzje p
    LEFT JOIN tematy t ON t.id = p.temat_id
    LEFT JOIN kamienie_karty km ON km.id = p.kamien_id
    ORDER BY p.data DESC LIMIT 25`).all();

  res.json({
    sciezki, tematy, podsumowanie, decyzje,
    leady: {
      norma_calkowita_dni: suma,
      w_kwalifikacji: leadyAktywne.length,
      po_normie: leadyAktywne.filter(l => l.po_normie).length,
      lista: leadyAktywne.slice(0, 30),
    },
    metryki: policzMetryki(),
  });
});

// Faza ACT: decyzja korygujaca. Opcjonalnie od razu rodzi nastepne dzialanie,
// zeby temat nie zostal bez kolejnego kroku.
api.post('/tematy/:id/pdca-decyzja', (req, res) => {
  const temat = db.prepare('SELECT * FROM tematy WHERE id = ?').get(req.params.id);
  if (!temat) return res.status(404).json({ error: 'Nie znaleziono tematu' });

  const { decyzja, diagnoza, uzasadnienie, dzialanie } = req.body;
  const DOZWOLONE = ['kontynuuj', 'zmien_podejscie', 'eskaluj', 'zamknij'];
  if (!DOZWOLONE.includes(decyzja)) {
    return res.status(400).json({ error: 'Decyzja musi być jedną z: ' + DOZWOLONE.join(', ') });
  }

  let dzialanieId = null;
  if (dzialanie?.cel) {
    const r = db.prepare(`INSERT INTO dzialania (typ, cel, opis, temat_id, klient_id, kamien_id, termin, status, template_id, notatki)
      VALUES (?,?,?,?,?,?,?, 'planowane', ?, ?)`)
      .run(dzialanie.typ || 'inne', dzialanie.cel, dzialanie.opis || null, temat.id, temat.klient_id,
        temat.kamien_id, dzialanie.termin || null, dzialanie.template_id || null,
        'Utworzone decyzją PDCA: ' + decyzja);
    dzialanieId = Number(r.lastInsertRowid);
  }

  const r = db.prepare(`INSERT INTO pdca_decyzje (temat_id, kamien_id, decyzja, diagnoza, uzasadnienie, dzialanie_id, kto)
    VALUES (?,?,?,?,?,?,?)`)
    .run(temat.id, temat.kamien_id, decyzja, diagnoza || null, uzasadnienie || null, dzialanieId,
      req.body.kto || temat.handlowiec || null);

  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_po, opis) VALUES (?,?,?,?)')
    .run(temat.id, 'decyzja PDCA', decyzja, [diagnoza, uzasadnienie].filter(Boolean).join(' — ') || null);

  res.json({ id: Number(r.lastInsertRowid), dzialanie_id: dzialanieId, stan: stanPdca(temat) });
});

// ---------- IMPORT REALNEGO PIPELINE (arkusz K. Latosia) ----------
// Etap interpretowany z % wygranej: temat trafia na kamien, w ktorego pasmo wpada %,
// wczesniejsze kamienie auto-potwierdzone (dowod: stan z importu).
function interpretujPipeline(pozycje) {
  // Import z arkusza nie zna etapu projektu inwestora, więc trafia na ścieżkę
  // koncepcyjną — dłuższą i ostrożniejszą. Zmiana ścieżki po imporcie:
  // /tematy/:id/przenies-standard.
  const std = db.prepare(`SELECT * FROM karty_ratingu WHERE kod = 'KONCEPCJA' AND aktywna = 1`).get()
    || db.prepare(`SELECT * FROM karty_ratingu WHERE kod = 'STANDARD'`).get();
  const kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(std.id);
  const m1 = kamienie[0];
  const znajdzTemat = db.prepare('SELECT id FROM tematy WHERE identyfikator = ?');
  return { std, kamienie, propozycje: pozycje.map(p => {
    const pc = p.prawd_pct;
    const kamien = pc != null ? (kamienie.find(k => pc >= k.prawd_min && pc <= k.prawd_max) || m1) : m1;
    const doPotwierdzenia = kamienie.filter(k => k.kolejnosc < kamien.kolejnosc);
    const idBaza = (p.klient_nazwa || p.inwestor).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 20)
      + '_' + (p.rodzaj || 'inw').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 10);
    return { ...p, kamien_kod: kamien.kod, kamien_nazwa: kamien.nazwa, kamien_id: kamien.id,
      potwierdzone_kody: doPotwierdzenia.map(k => k.kod), potwierdzone_ids: doPotwierdzenia.map(k => k.id),
      identyfikator_baza: idBaza, duplikat: false };
  }) };
}

api.post('/import/pipeline/podglad', (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ error: 'Brak pliku' });
  const pozycje = parsujPipeline(Buffer.from(base64, 'base64'));
  const { propozycje } = interpretujPipeline(pozycje);
  const znajdz = db.prepare('SELECT id FROM tematy WHERE identyfikator LIKE ?');
  for (const p of propozycje) p.duplikat = !!znajdz.get(p.identyfikator_baza + '%');
  res.json({ propozycje });
});

api.post('/import/pipeline/wykonaj', (req, res) => {
  const { wiersze, handlowiec } = req.body;
  if (!Array.isArray(wiersze) || !wiersze.length) return res.status(400).json({ error: 'Brak wierszy do importu' });
  const std = db.prepare(`SELECT * FROM karty_ratingu WHERE kod = 'STANDARD'`).get();
  const kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(std.id);
  const stat = { tematy_nowe: 0, klienci_nowi: 0, osoby_nowe: 0, pominiete: 0 };

  const znajdzKlienta = db.prepare('SELECT id FROM klienci WHERE lower(nazwa) = lower(?)');
  const wstawKlienta = db.prepare('INSERT INTO klienci (nazwa, zrodlo_pozyskania, notatki) VALUES (?,?,?)');
  const znajdzOsobe = db.prepare('SELECT id FROM osoby WHERE klient_id = ? AND lower(imie_nazwisko) = lower(?)');
  const wstawOsobe = db.prepare('INSERT INTO osoby (klient_id, imie_nazwisko, stanowisko, rola_w_decyzji) VALUES (?,?,?,?)');

  db.exec('BEGIN');
  try {
    for (const p of wiersze) {
      let identyfikator = generujIdTematu(p.klient_nazwa, p.rodzaj, p.inwestor);
      // Klient (dedup po nazwie)
      let klientId = null;
      if (p.klient_nazwa) {
        const ist = znajdzKlienta.get(p.klient_nazwa);
        if (ist) klientId = ist.id;
        else { klientId = Number(wstawKlienta.run(p.klient_nazwa, 'Pipeline (import)', p.inwestor !== p.klient_nazwa ? 'Z pipeline: ' + p.inwestor : null).lastInsertRowid); stat.klienci_nowi++; }
      }
      // Osoba
      let osobaId = null;
      if (p.osoba?.imie_nazwisko && klientId) {
        const isto = znajdzOsobe.get(klientId, p.osoba.imie_nazwisko);
        if (isto) osobaId = isto.id;
        else { osobaId = Number(wstawOsobe.run(klientId, p.osoba.imie_nazwisko, p.osoba.stanowisko, p.osoba.rola_w_decyzji).lastInsertRowid); stat.osoby_nowe++; }
      }
      const kamien = kamienie.find(k => k.kod === p.kamien_kod) || kamienie[0];
      const potwierdzone = kamienie.filter(k => k.kolejnosc < kamien.kolejnosc);
      const prawd = p.prawd_pct != null ? p.prawd_pct : Math.round(kamien.prawd_start / 2);

      const r = db.prepare(`INSERT INTO tematy
        (identyfikator, nazwa, klient_id, osoba_id, handlowiec, zrodlo, model_realizacji, co_budujemy,
         data_startu, wartosc_kontraktu, marza_pct, termin_oferty, termin_realizacji, czas_trwania_mies,
         karta_id, kamien_id, prawdopodobienstwo, korekta_reczna, status, czy_bierzemy)
        VALUES (?,?,?,?,?,?,?,?,date('now'),?,?,?,?,?,?,?,?,?, 'otwarty','ofertujemy')`)
        .run(identyfikator, p.inwestor, klientId, osobaId, handlowiec || 'K. Latoś', 'Pipeline (import)',
          p.model_realizacji || 'Generalne wykonawstwo', p.rodzaj || null, p.wartosc || 0, p.marza_pct ?? 9,
          p.termin_oferty || null, p.termin_realizacji || null, p.czas_trwania_mies || 12,
          std.id, kamien.id, prawd, p.prawd_pct != null ? 1 : 0);
      const tematId = Number(r.lastInsertRowid);
      // Auto-potwierdzenie wczesniejszych kamieni (stan z importu)
      for (const km of potwierdzone) {
        db.prepare('INSERT INTO potwierdzenia_kamieni (temat_id, kamien_id, dowod, potwierdzajacy) VALUES (?,?,?,?)')
          .run(tematId, km.id, `Stan z importu pipeline (${prawd}% wygranej)`, handlowiec || 'K. Latoś');
      }
      db.prepare('INSERT INTO milestone_wejscia (temat_id, kamien_id) VALUES (?,?)').run(tematId, kamien.id);
      db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_po, opis) VALUES (?,?,?,?)')
        .run(tematId, 'import pipeline', `${kamien.kod} / ${prawd}%`,
          `Zaimportowany z realnego pipeline; ${potwierdzone.length} kamieni auto-potwierdzonych`);
      stat.tematy_nowe++;
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  res.json(stat);
});

// ---------- DANE DEMO (prezentacja) ----------
const SCIEZKA_BACKUP = path.join(DATA_DIR, 'wpip-crm.przed-demo.sqlite');

api.get('/demo/status', (req, res) => {
  const flaga = db.prepare(`SELECT wartosc FROM konfiguracja WHERE klucz = 'demo_seed'`).get();
  res.json({ demo_zaladowane: !!flaga, data_zaladowania: flaga?.wartosc || null, backup_istnieje: fs.existsSync(SCIEZKA_BACKUP) });
});

// Zaladowanie danych demo: najpierw bezpieczny backup (VACUUM INTO), potem seed
api.post('/demo/seed', (req, res) => {
  if (!fs.existsSync(SCIEZKA_BACKUP)) {
    db.exec(`VACUUM INTO '${SCIEZKA_BACKUP.replace(/'/g, "''")}'`);
  }
  db.exec('BEGIN');
  try {
    const raport = seedDemo(db);
    db.exec('COMMIT');
    res.json({ ok: true, raport });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

// Przywrocenie stanu sprzed demo: plik .restore + restart procesu (db.js podmienia przy starcie)
api.post('/demo/przywroc', (req, res) => {
  if (!fs.existsSync(SCIEZKA_BACKUP)) {
    return res.status(400).json({ error: 'Brak backupu sprzed demo — nie ma czego przywracać.' });
  }
  fs.copyFileSync(SCIEZKA_BACKUP, path.join(DATA_DIR, 'wpip-crm.restore.sqlite'));
  res.json({ ok: true, restart: true });
  // exit(1) -> Railway restartuje serwis; przy starcie db.js podmieni baze
  setTimeout(() => process.exit(1), 400);
});

