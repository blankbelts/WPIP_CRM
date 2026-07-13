// API WPIP CRM - wszystkie trasy REST
import { Router } from 'express';
import { db, KOMPONENTY, NAZWY_KOMPONENTOW } from './db.js';
import { parsujPlik, przygotujImport } from './import-ki.js';
import { policzScore, przeliczLeada, opcjeWersji, zamrozWersje, logujLeada } from './scoring.js';
import { werdyktKwalifikacji, generujIdTematu, autoOdpowiedzi, autoProces } from './kwalifikacja.js';
import { przeliczTemat, dniWEtapie, czyZastygly, sprawdzRecykling } from './silnik-pipeline.js';

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
  'sposob_pozyskania', 'zrodlo_wiedzy_wpip', 'proces_researchu', 'identyfikator'];

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

  // Persona/pipeline: FAST-TRACK dla klienta powracającego, inaczej STANDARD
  let kod = req.body.pipeline_kod;
  if (!kod) kod = /powracaj/i.test(lead.proces_researchu || '') ? 'FAST_TRACK' : 'STANDARD';
  const karta = db.prepare('SELECT * FROM karty_ratingu WHERE kod = ?').get(kod);
  if (!karta) return res.status(400).json({ error: 'Nie znaleziono pipeline persony: ' + kod });
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
  logujLeada(lead.id, 'uruchomienie tematu', lead.kamien, 'pipeline: ' + karta.nazwa, `Temat ${identyfikator} na kamieniu M1`);
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
    WHERE t.status = 'otwarty' AND km.kod IN ('M5', 'F3')
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

// ---------- KARTY RATINGU ----------
api.get('/karty', (req, res) => {
  const karty = db.prepare('SELECT * FROM karty_ratingu WHERE aktywna = 1').all();
  for (const k of karty) {
    k.kamienie = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(k.id);
  }
  res.json(karty);
});
api.post('/karty', (req, res) => {
  const { nazwa, opis = '' } = req.body;
  const r = db.prepare('INSERT INTO karty_ratingu (nazwa, opis) VALUES (?,?)').run(nazwa, opis);
  res.json({ id: Number(r.lastInsertRowid) });
});
api.put('/kamienie/:id', (req, res) => {
  updateById('kamienie_karty', req.params.id, pick(req.body, ['nazwa', 'prawd_start', 'prawd_min', 'prawd_max', 'kolejnosc']));
  res.json({ ok: true });
});
api.post('/karty/:id/kamienie', (req, res) => {
  const { nazwa, prawd_start, prawd_min, prawd_max, kolejnosc } = req.body;
  const r = db.prepare('INSERT INTO kamienie_karty (karta_id, kolejnosc, nazwa, prawd_start, prawd_min, prawd_max) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, kolejnosc, nazwa, prawd_start, prawd_min, prawd_max);
  res.json({ id: Number(r.lastInsertRowid) });
});

// ---------- TEMATY (pipeline) ----------
const TEMAT_POLA = ['nazwa', 'klient_id', 'inwestycja_id', 'osoba_id', 'handlowiec', 'zrodlo',
  'model_realizacji', 'co_budujemy', 'data_startu', 'wartosc_kontraktu', 'marza_pct', 'termin_oferty',
  'termin_realizacji', 'czas_trwania_mies', 'czy_bierzemy', 'powod_odpuszczenia', 'notatki'];

api.get('/tematy', (req, res) => {
  sprawdzRecykling();
  const tematy = db.prepare(`
    SELECT t.*, k.nazwa AS klient_nazwa, km.nazwa AS kamien_nazwa, km.kod AS kamien_kod, km.kolejnosc AS kamien_kolejnosc,
      km.prawd_min, km.prawd_max, km.prog_zastygniecia_dni, kr.nazwa AS karta_nazwa, kr.kod AS pipeline_kod,
      (SELECT COUNT(*) FROM dzialania d WHERE d.temat_id = t.id AND d.status = 'planowane') AS dzialania_otwarte
    FROM tematy t
    LEFT JOIN klienci k ON k.id = t.klient_id
    LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN karty_ratingu kr ON kr.id = t.karta_id
    ORDER BY km.kolejnosc DESC, t.wartosc_kontraktu DESC`).all();
  for (const t of tematy) { t.dni_w_etapie = dniWEtapie(t); t.zastygly = czyZastygly(t); }
  res.json(tematy);
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
  for (const km of t.kamienie) {
    km.potwierdzony = potwSet.has(km.id);
    km.szablony = db.prepare('SELECT * FROM task_szablony WHERE kamien_id = ? AND aktywny = 1 ORDER BY kolejnosc').all(km.id);
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
  db.prepare('INSERT INTO potwierdzenia_kamieni (temat_id, kamien_id, dowod, potwierdzajacy) VALUES (?,?,?,?)')
    .run(t.id, kamien_id, dowod, potwierdzajacy || t.handlowiec || null);
  const stan = przeliczTemat(t.id);
  db.prepare('INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(t.id, 'potwierdzenie kamienia', `${t.prawdopodobienstwo}%`, `${stan.prawdopodobienstwo}%`,
      `${km.kod} potwierdzony (dowód: ${String(dowod).slice(0, 120)})`);
  res.json({ ok: true, ...stan });
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
  res.json({ ok: true });
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

  db.prepare('UPDATE dzialania SET wynik = ?, status = ? WHERE id = ?').run(wynik, 'wykonane', d.id);

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

  res.json({
    zadania, bez_ruchu: bezRuchu, zastygle,
    postep: {
      tematy_otwarte: tematyOtwarte.length, wartosc_wazona: wartoscWazona,
      liczba_zastygle: zastygle.length, liczba_bez_ruchu: bezRuchu.length,
      wg_kamienia: wgKamienia, recykling: recyklingDue,
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
        // Wystapienie w kolejnej grupie: adnotacja + aktualizacja danych inwestycji + ew. przeliczenie
        stat.wystapienia++;
        wstawWystapienie.run(istniejacyLead.id, grupa_id, `Wystąpił w imporcie do grupy "${grupa.nazwa}"`);

        const zmiany = [];
        if (p.etap && p.etap !== inw.etap_projektu) zmiany.push(['etap_projektu', inw.etap_projektu, p.etap]);
        const kosztNowy = Number(p.koszt) || null;
        if (kosztNowy && kosztNowy !== inw.wartosc_inwestycji) zmiany.push(['wartosc_inwestycji', inw.wartosc_inwestycji, kosztNowy]);

        if (zmiany.length) {
          stat.aktualizacje_danych++;
          for (const [pole, , po] of zmiany) {
            db.prepare(`UPDATE inwestycje SET ${pole} = ? WHERE id = ?`).run(po, inw.id);
          }
          // Aktualizacja wyborow B/D wynikajacych z danych + przeliczenie wersja LEADA (nie grupy importu)
          const wybory = JSON.parse(istniejacyLead.wybory || '{}');
          if (p.wybory.B) wybory.B = p.wybory.B;
          if (p.wybory.D) wybory.D = p.wybory.D;
          db.prepare('UPDATE leady SET wybory = ? WHERE id = ?').run(JSON.stringify(wybory), istniejacyLead.id);
          logujLeada(istniejacyLead.id, 'aktualizacja z importu',
            zmiany.map(z => `${z[0]}: ${z[1] ?? '—'}`).join(', '),
            zmiany.map(z => `${z[0]}: ${z[2]}`).join(', '),
            `Świeże dane z importu do grupy "${grupa.nazwa}"`);
          if (istniejacyLead.wersja_id) {
            const wynik = przeliczLeada(istniejacyLead.id, istniejacyLead.wersja_id, 'Aktualizacja danych z importu');
            if (wynik.priorytet !== istniejacyLead.priorytet) stat.zmiany_priorytetu++;
          }
        }
        continue;
      }

      // Klient (dedup po nazwie)
      let klientId = null;
      if (p.klient_nazwa) {
        const istKlient = znajdzKlienta.get(p.klient_nazwa);
        if (istKlient) klientId = istKlient.id;
        else {
          klientId = Number(wstawKlienta.run(
            p.klient_nazwa, zrodloWpisu, p.branza || null, p.miasto || null, p.wojewodztwo || null,
            p.inwestor && p.inwestor !== p.klient_nazwa ? 'Pełne pole Inwestor z importu: ' + p.inwestor : null).lastInsertRowid);
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
        statusResearchu !== 'SZARY' ? 'Status researchu przeniesiony z arkusza importu' : null,
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

// ---------- METRYKI PIPELINE (dashboard v2) ----------
function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

api.get('/metryki', (req, res) => {
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

  res.json({
    lejek, utrata, zadania,
    am_coverage: {
      konta: am.total || 0, z_planem: am.z_planem || 0, zalegle: am.zalegle || 0,
      pokrycie_pct: am.total ? Math.round(100 * (am.z_planem || 0) / am.total) : null,
    },
  });
});

// ---------- DASHBOARD ----------
api.get('/dashboard', (req, res) => {
  const tematyOtwarte = db.prepare(`
    SELECT t.*, km.nazwa AS kamien_nazwa, km.kolejnosc AS kamien_kolejnosc, k.nazwa AS klient_nazwa
    FROM tematy t LEFT JOIN kamienie_karty km ON km.id = t.kamien_id
    LEFT JOIN klienci k ON k.id = t.klient_id
    WHERE t.status = 'otwarty'`).all();

  const wartoscPipeline = tematyOtwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0), 0);
  const wartoscWazona = tematyOtwarte.reduce((s, t) => s + (t.wartosc_kontraktu || 0) * (t.prawdopodobienstwo || 0) / 100, 0);

  const zamkniete = db.prepare(`SELECT status, COUNT(*) c FROM tematy WHERE status IN ('wygrany','przegrany') GROUP BY status`).all();
  const wygrane = zamkniete.find(z => z.status === 'wygrany')?.c || 0;
  const przegrane = zamkniete.find(z => z.status === 'przegrany')?.c || 0;
  const winRate = (wygrane + przegrane) > 0 ? Math.round(100 * wygrane / (wygrane + przegrane)) : null;

  const leadyWgPriorytetu = db.prepare(`SELECT priorytet, COUNT(*) c FROM leady
    WHERE status = 'aktywny' GROUP BY priorytet`).all();
  const leadyWgKamienia = db.prepare(`SELECT kamien, COUNT(*) c FROM leady
    WHERE status = 'aktywny' GROUP BY kamien`).all();

  const kwartaly = {};
  for (const t of tematyOtwarte.concat(db.prepare(`SELECT t.*, NULL AS kamien_nazwa, NULL AS kamien_kolejnosc, NULL AS klient_nazwa FROM tematy t WHERE t.status = 'wygrany'`).all())) {
    const start = t.termin_realizacji || t.data_startu;
    if (!start || !t.wartosc_kontraktu || !t.czas_trwania_mies) continue;
    const d0 = new Date(start);
    if (isNaN(d0)) continue;
    const mies = t.czas_trwania_mies;
    const naMies = t.wartosc_kontraktu / mies;
    const prawd = t.status === 'wygrany' ? 100 : (t.prawdopodobienstwo || 0);
    for (let m = 0; m < mies; m++) {
      const dd = new Date(d0.getFullYear(), d0.getMonth() + m, 1);
      const q = `${dd.getFullYear()} Q${Math.floor(dd.getMonth() / 3) + 1}`;
      kwartaly[q] ||= { kwartal: q, planowany: 0, wazony: 0 };
      kwartaly[q].planowany += naMies;
      kwartaly[q].wazony += naMies * prawd / 100;
    }
  }

  const dzialaniaTydzien = db.prepare(`
    SELECT d.*, t.identyfikator AS temat_identyfikator, l.nazwa AS lead_nazwa
    FROM dzialania d LEFT JOIN tematy t ON t.id = d.temat_id LEFT JOIN leady l ON l.id = d.lead_id
    WHERE d.status = 'planowane' AND (d.termin IS NULL OR d.termin <= date('now', '+7 days'))
    ORDER BY d.termin IS NULL, d.termin LIMIT 20`).all();

  const decyzjeKomitetu = db.prepare(`SELECT decyzja, COUNT(*) c FROM decyzje_komitetu GROUP BY decyzja`).all();
  const kolejkaKomitetu = db.prepare(`SELECT COUNT(*) c FROM leady
    WHERE kamien = 'Zakwalifikowany' AND status = 'aktywny' AND temat_id IS NULL`).get().c;

  res.json({
    tematy_otwarte: tematyOtwarte.length,
    wartosc_pipeline: wartoscPipeline,
    wartosc_wazona: wartoscWazona,
    win_rate: winRate,
    wygrane, przegrane,
    leady_wg_priorytetu: leadyWgPriorytetu,
    leady_wg_kamienia: leadyWgKamienia,
    kwartaly: Object.values(kwartaly).sort((a, b) => a.kwartal.localeCompare(b.kwartal)),
    dzialania_tydzien: dzialaniaTydzien,
    decyzje_komitetu: decyzjeKomitetu,
    kolejka_komitetu: kolejkaKomitetu,
    tematy_wg_kamienia: tematyOtwarte.reduce((acc, t) => {
      const k = t.kamien_nazwa || '?';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  });
});
