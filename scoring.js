// Silnik scoringu leadow: wybory {komponent: etykieta} + wersja -> punkty, priorytet, dyskwalifikacja
// Punkty NIE sa zapisywane na leadzie na stale - leada opisuja wybory; punkty liczone z wersji,
// dzieki czemu przeliczenie grupy inna wersja wymaga tylko ponownego lookupu.
import { db, KOMPONENTY } from './db.js';

export function opcjeWersji(wersjaId) {
  const rows = db.prepare('SELECT * FROM wersja_opcje WHERE wersja_id = ? ORDER BY komponent, kolejnosc').all(wersjaId);
  const grouped = {};
  for (const r of rows) (grouped[r.komponent] ||= []).push(r);
  return grouped;
}

export function policzScore(wybory, wersjaId) {
  const wersja = db.prepare('SELECT * FROM wersje_scoringu WHERE id = ?').get(wersjaId);
  if (!wersja) throw new Error('Nie znaleziono wersji scoringu');
  const opcje = opcjeWersji(wersjaId);

  let total = 0, dyskwalifikacja = 0, powod = null;
  const braki = [];
  for (const komp of KOMPONENTY) {
    const etykieta = wybory[komp];
    if (!etykieta) { braki.push(komp); continue; }
    const opcja = (opcje[komp] || []).find(o => o.etykieta === etykieta);
    if (!opcja) { braki.push(komp); continue; }
    total += opcja.punkty;
    if (opcja.dyskwalifikacja) { dyskwalifikacja = 1; powod = `${komp}: ${etykieta}`; }
  }
  const priorytet = dyskwalifikacja ? 'X'
    : total >= wersja.prog_a ? 'A'
    : total >= wersja.prog_b ? 'B'
    : total >= wersja.prog_c ? 'C' : 'D';
  return { total, priorytet, dyskwalifikacja, powod, braki };
}

// Przelicza pojedynczego leada wskazana wersja; zapisuje i loguje zmiane priorytetu
export function przeliczLeada(leadId, wersjaId, kontekst = 'przeliczenie') {
  const lead = db.prepare('SELECT * FROM leady WHERE id = ?').get(leadId);
  if (!lead) throw new Error('Nie znaleziono leada');
  const wybory = JSON.parse(lead.wybory || '{}');
  const wynik = policzScore(wybory, wersjaId);

  db.prepare(`UPDATE leady SET wersja_id = ?, score_total = ?, priorytet = ?,
    dyskwalifikacja_x = ?, dyskwalifikacja_powod = COALESCE(?, dyskwalifikacja_powod) WHERE id = ?`)
    .run(wersjaId, wynik.total, wynik.priorytet, wynik.dyskwalifikacja,
      wynik.dyskwalifikacja ? wynik.powod : null, leadId);

  if (lead.priorytet !== wynik.priorytet || lead.score_total !== wynik.total) {
    db.prepare('INSERT INTO historia_leada (lead_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
      .run(leadId, 'zmiana scoringu', `${lead.score_total} / ${lead.priorytet}`,
        `${wynik.total} / ${wynik.priorytet}`, kontekst);
  }
  return wynik;
}

// Uzycie wersji do przeliczenia zamraza ja (audyt: wiadomo czym policzono kazdy score)
export function zamrozWersje(wersjaId) {
  db.prepare(`UPDATE wersje_scoringu SET status = 'zamrożona' WHERE id = ? AND status = 'robocza'`).run(wersjaId);
}

export function logujLeada(leadId, typ, przed, po, opis) {
  db.prepare('INSERT INTO historia_leada (lead_id, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?)')
    .run(leadId, typ, przed ?? null, po ?? null, opis ?? null);
}
