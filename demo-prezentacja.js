// DEMO PREZENTACYJNE: rozgrzewa procesy na zaimportowanych danych (leady KI + tematy z arkusza).
// Uruchomienie: node demo-prezentacja.js (przy WYLACZONYM serwerze).
// Cofniecie: przywroc backup wpip-crm.przed-demo.sqlite (kopiowany przed seedem).
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('./wpip-crm.sqlite');
db.exec('PRAGMA foreign_keys = ON');

// Deterministyczny pseudo-random (powtarzalne demo)
let ziarno = 42;
const rnd = () => (ziarno = (ziarno * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const los = (arr) => arr[Math.floor(rnd() * arr.length)];
const calk = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const dniTemu = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const dataTemu = (n) => dniTemu(n).slice(0, 10);

console.log('== DEMO SEED start ==');

// ---------- 0. Slowniki pomocnicze ----------
const std = db.prepare(`SELECT * FROM karty_ratingu WHERE kod = 'STANDARD'`).get();
const fast = db.prepare(`SELECT * FROM karty_ratingu WHERE kod = 'FAST_TRACK'`).get();
const kamStd = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(std.id);
const kamFast = db.prepare('SELECT * FROM kamienie_karty WHERE karta_id = ? ORDER BY kolejnosc').all(fast.id);
const powodyWg = {};
for (const p of db.prepare('SELECT * FROM powody_zamkniecia WHERE aktywny = 1').all()) {
  (powodyWg[p.kamien_kod] ||= []).push(p);
}
const klienci = db.prepare('SELECT id, nazwa FROM klienci ORDER BY id').all();
const HANDLOWCY = ['K. Latoś', 'K. Latoś', 'K. Latoś', 'P. Kowalski']; // 75/25

const wstawWejscie = db.prepare('INSERT INTO milestone_wejscia (temat_id, kamien_id, data_wejscia) VALUES (?,?,?)');
const wstawPotw = db.prepare('INSERT INTO potwierdzenia_kamieni (temat_id, kamien_id, data, dowod, potwierdzajacy) VALUES (?,?,?,?,?)');
const wstawHist = db.prepare('INSERT INTO historia_tematu (temat_id, data, typ_zmiany, wartosc_przed, wartosc_po, opis) VALUES (?,?,?,?,?,?)');
const wstawDzial = db.prepare(`INSERT INTO dzialania (typ, cel, temat_id, klient_id, kamien_id, termin, wynik, status, utworzono, template_id)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

// Typowy czas w etapie (dni) - do median
const CZAS_ETAPU = { M1: [8, 18], M2: [10, 22], M3: [14, 28], M4: [12, 25], M5: [10, 20], M6: [18, 32], M7: [14, 26], M8: [10, 20] };
const TYPY_ZADAN = ['telefon', 'mail', 'spotkanie', 'research', 'wizyta', 'warsztat'];
// Skutecznosc typow (do rozkladu wynikow): [typ, szansa sukcesu]
const SKUTECZNOSC = { wizyta: .85, warsztat: .8, spotkanie: .72, research: .7, telefon: .5, mail: .32 };

// ---------- 1. Historyczne domkniete tematy (konwersje + win/loss + velocity) ----------
// dokad: indeks kamienia do ktorego doszedl (0=M1... 8=WYGRANA); wynik: W=wygrany, P=przegrany, R=recycled
const PLAN_HISTORII = [
  // wygrane (dochodza do konca) - 11 szt.
  ...Array(11).fill(['W', 8]),
  // przegrane wcześnie (M1-M3) - 12
  ...Array(4).fill(['P', 0]), ...Array(4).fill(['P', 1]), ...Array(4).fill(['P', 2]),
  // przegrane pozniej (M5-M8) - 10
  ...Array(3).fill(['P', 4]), ...Array(3).fill(['P', 5]), ...Array(2).fill(['P', 6]), ...Array(2).fill(['P', 7]),
  // recykling - 9 (rozne etapy)
  ...Array(3).fill(['R', 0]), ...Array(2).fill(['R', 1]), ...Array(2).fill(['R', 3]), ...Array(2).fill(['R', 4]),
];

let licznikDemo = 0;
for (const [wynik, dokadIdx] of PLAN_HISTORII) {
  licznikDemo++;
  const klient = los(klienci);
  const handlowiec = los(HANDLOWCY);
  const wartosc = calk(10, 65);
  const marza = calk(8, 11);
  const startDniTemu = calk(120, 420);
  const ident = `DEMO_${String(licznikDemo).padStart(2, '0')}_${klient.nazwa.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;

  // wejscia w kamienie: od M1 do dokadIdx, kazdy etap trwa wg CZAS_ETAPU
  let dzien = startDniTemu;
  const wejscia = [];
  for (let i = 0; i <= dokadIdx && i < kamStd.length; i++) {
    wejscia.push([kamStd[i], dzien]);
    const [a, b] = CZAS_ETAPU[kamStd[i].kod] || [10, 20];
    dzien -= calk(a, b);
  }
  const koniecDniTemu = Math.max(3, dzien);
  const ostatniKamien = wejscia[wejscia.length - 1][0];

  const statusKoncowy = wynik === 'W' ? 'wygrany' : wynik === 'P' ? 'przegrany' : 'recycled';
  const powodyEtapu = powodyWg[ostatniKamien.kod] || [];
  const powod = wynik === 'W' ? los(['Relacja', 'Dopasowanie techniczne', 'Referencje', 'Cena'])
    : wynik === 'R' ? (powodyEtapu.filter(p => p.czy_recyklingowalny)[0]?.nazwa || 'Temat zamrożony')
    : (powodyEtapu.filter(p => !p.czy_recyklingowalny)[0]?.nazwa || 'Odpadliśmy cenowo');
  const recycleDate = wynik === 'R' ? dataTemu(-calk(20, 120)) : null; // przyszlosc

  const r = db.prepare(`INSERT INTO tematy
    (identyfikator, nazwa, klient_id, handlowiec, zrodlo, model_realizacji, data_startu,
     wartosc_kontraktu, marza_pct, czas_trwania_mies, karta_id, kamien_id, prawdopodobienstwo,
     status, czy_bierzemy, przyczyna_zamkniecia, recycle_date, utworzono, tagi)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ofertujemy',?,?,?,?)`)
    .run(ident, `Demo: ${klient.nazwa}`, klient.id, handlowiec, 'Baza sygnałów (KI)', 'Generalne wykonawstwo',
      dataTemu(startDniTemu), wartosc, marza, calk(9, 14), std.id, ostatniKamien.id,
      wynik === 'W' ? 100 : 0, statusKoncowy, powod, recycleDate, dniTemu(startDniTemu), 'demo');
  const tid = Number(r.lastInsertRowid);

  for (const [km, d] of wejscia) wstawWejscie.run(tid, km.id, dniTemu(d));
  // potwierdzenia: wszystkie kamienie PRZED ostatnim (a przy wygranej takze ostatni)
  const doPotw = wynik === 'W' ? wejscia : wejscia.slice(0, -1);
  for (const [km, d] of doPotw) {
    const [a, b] = CZAS_ETAPU[km.kod] || [10, 20];
    wstawPotw.run(tid, km.id, dniTemu(Math.max(2, d - calk(a, b))), `Potwierdzone (demo): ${km.nazwa}`, handlowiec);
  }
  wstawHist.run(tid, dniTemu(koniecDniTemu), wynik === 'R' ? 'recykling' : 'zamkniecie', 'otwarty', statusKoncowy, powod);

  // dzialania wykonane z wynikami (2-4 na temat)
  for (let z = 0; z < calk(2, 4); z++) {
    const typ = los(TYPY_ZADAN);
    const sukces = rnd() < (SKUTECZNOSC[typ] ?? .5);
    const [kmZ, dZ] = los(wejscia);
    wstawDzial.run(typ, `Demo: ${typ} w sprawie ${klient.nazwa}`, tid, klient.id, kmZ.id,
      dataTemu(dZ - calk(1, 5)), sukces ? 'Osiągnięty' : los(['Nieosiągnięty', 'Zwłoka']), 'wykonane', dniTemu(dZ), null);
  }
}
console.log('1. Historyczne tematy demo:', PLAN_HISTORII.length);

// ---------- 2. Otwarte tematy (14 realnych + testowe): urealnij daty i checklisty ----------
const otwarte = db.prepare(`SELECT t.*, km.kolejnosc AS akt_kolejnosc FROM tematy t
  JOIN kamienie_karty km ON km.id = t.kamien_id WHERE t.status = 'otwarty'`).all();
for (const t of otwarte) {
  const kamienie = t.karta_id === fast.id ? kamFast : kamStd;
  const przeszte = kamienie.filter(k => k.kolejnosc < t.akt_kolejnosc);
  // przelicz od nowa daty wejsc (usun stare)
  db.prepare('DELETE FROM milestone_wejscia WHERE temat_id = ?').run(t.id);
  let dzien = 0;
  // ile dni w AKTUALNYM etapie: przewaznie w normie, 3-4 tematy zastygle
  const wAktualnym = rnd() < 0.22 ? calk(25, 45) : calk(2, 12);
  dzien = wAktualnym;
  wstawWejscie.run(t.id, t.kamien_id, dniTemu(dzien));
  for (const km of [...przeszte].reverse()) {
    const [a, b] = CZAS_ETAPU[km.kod] || [10, 20];
    dzien += calk(a, b);
    wstawWejscie.run(t.id, km.id, dniTemu(dzien));
  }
  db.prepare('UPDATE tematy SET utworzono = ?, data_startu = ? WHERE id = ?')
    .run(dniTemu(dzien + calk(2, 8)), dataTemu(dzien + calk(2, 8)), t.id);
  // backdatuj potwierdzenia przesztych kamieni
  for (const km of przeszte) {
    const w = db.prepare('SELECT data_wejscia FROM milestone_wejscia WHERE temat_id = ? AND kamien_id = ?').get(t.id, km.id);
    db.prepare('UPDATE potwierdzenia_kamieni SET data = ? WHERE temat_id = ? AND kamien_id = ?')
      .run(w ? w.data_wejscia : dniTemu(dzien), t.id, km.id);
  }
  // odhacz kryteria przesztych kamieni + czesc aktualnego
  for (const km of przeszte) {
    for (const kr of db.prepare('SELECT id FROM kamien_kryteria WHERE kamien_id = ? AND aktywny = 1').all(km.id)) {
      db.prepare('INSERT OR IGNORE INTO kryteria_odhaczenia (temat_id, kryterium_id, kto, data) VALUES (?,?,?,?)')
        .run(t.id, kr.id, t.handlowiec, dniTemu(dzien));
    }
  }
  const krytAkt = db.prepare('SELECT id FROM kamien_kryteria WHERE kamien_id = ? AND aktywny = 1').all(t.kamien_id);
  for (const kr of krytAkt.slice(0, Math.floor(krytAkt.length * rnd()))) {
    db.prepare('INSERT OR IGNORE INTO kryteria_odhaczenia (temat_id, kryterium_id, kto, data) VALUES (?,?,?,?)')
      .run(t.id, kr.id, t.handlowiec, dniTemu(calk(0, wAktualnym)));
  }
}
console.log('2. Otwarte tematy urealnione:', otwarte.length);

// ---------- 3. Zadania na ten tydzien (roadmapa zyje) ----------
const szablonyWg = {};
for (const s of db.prepare('SELECT * FROM task_szablony WHERE aktywny = 1').all()) {
  (szablonyWg[s.kamien_id] ||= []).push(s);
}
let zadanTydzien = 0;
for (const t of otwarte.slice(0, 12)) {
  const szab = (szablonyWg[t.kamien_id] || []);
  if (!szab.length) continue;
  const s = los(szab);
  db.prepare(`INSERT INTO dzialania (typ, cel, temat_id, klient_id, kamien_id, template_id, termin, status)
    VALUES (?,?,?,?,?,?,?, 'planowane')`)
    .run(s.typ, s.nazwa, t.id, t.klient_id, t.kamien_id, s.id, dataTemu(-calk(0, 5)));
  zadanTydzien++;
}
console.log('3. Zadania tygodnia:', zadanTydzien);

// ---------- 4. Leady KI: rozklad lejka prospectingowego ----------
const leadyAkt = db.prepare(`SELECT id, priorytet, dyskwalifikacja_x FROM leady WHERE status = 'aktywny'`).all();
let i = 0;
for (const l of leadyAkt) {
  i++;
  db.prepare('UPDATE leady SET utworzono = ? WHERE id = ?').run(dniTemu(calk(5, 130)), l.id);
  const kostka = rnd();
  if (l.dyskwalifikacja_x || kostka < 0.12) {
    db.prepare(`UPDATE leady SET status='odpuszczony', powod_odpuszczenia=? WHERE id=?`)
      .run(l.dyskwalifikacja_x ? 'Kwalifikacja wstępna negatywna' : los(['Zły marżowo', 'Brak dopasowania', 'Zły moment']), l.id);
  } else if (kostka < 0.20) {
    db.prepare(`UPDATE leady SET status='uspiony' WHERE id=?`).run(l.id);
  } else if (kostka < 0.44) {
    db.prepare(`UPDATE leady SET kamien='Lead surowy', kwalif_wynik=NULL WHERE id=?`).run(l.id);
  } else if (kostka < 0.70) {
    db.prepare(`UPDATE leady SET kamien='Kwalifikacja wstępna', kwalif_wynik='interesujący' WHERE id=?`).run(l.id);
  } else if (kostka < 0.88) {
    db.prepare(`UPDATE leady SET kamien='Research', kwalif_wynik='interesujący', status_researchu=? WHERE id=?`)
      .run(los(['SZARY', 'SZARY', 'ZIELONY', 'ŻÓŁTY']), l.id);
  } else if (kostka < 0.97) {
    db.prepare(`UPDATE leady SET kamien='Scoring', kwalif_wynik='interesujący', status_researchu=?, scoring_potwierdzony=? WHERE id=?`)
      .run(los(['ZIELONY', 'ZIELONY', 'ŻÓŁTY']), rnd() < 0.5 ? 1 : 0, l.id);
  } else {
    db.prepare(`UPDATE leady SET kamien='Zakwalifikowany', kwalif_wynik='interesujący', status_researchu='ZIELONY', scoring_potwierdzony=1 WHERE id=?`).run(l.id);
  }
  if (rnd() < 0.3) db.prepare('UPDATE leady SET handlowiec = ? WHERE id = ?').run('P. Kowalski', l.id);
}
console.log('4. Leady rozlozone w lejku:', leadyAkt.length);

// ---------- 5. Fast-track: 3 tematy klientow powracajacych ----------
const powracajacy = klienci.slice(0, 3);
const fastEtapy = [kamFast[0], kamFast[1], kamFast[2]];
powracajacy.forEach((k, idx) => {
  db.prepare('UPDATE klienci SET klient_powracajacy = 1, data_nastepnego_przegladu = ? WHERE id = ?')
    .run(dataTemu(-calk(10, 80)), k.id);
  const km = fastEtapy[idx];
  const ident = `FT_${k.nazwa.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}_etap2`;
  const r = db.prepare(`INSERT INTO tematy
    (identyfikator, nazwa, klient_id, handlowiec, zrodlo, model_realizacji, data_startu, wartosc_kontraktu,
     marza_pct, czas_trwania_mies, karta_id, kamien_id, prawdopodobienstwo, status, czy_bierzemy, utworzono, tagi)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ofertujemy', ?, 'demo,rozbudowa')`)
    .run(ident, `Rozbudowa: ${k.nazwa}`, k.id, 'K. Latoś', 'Klient powracający',
      'Zaprojektuj i buduj', dataTemu(calk(30, 90)), calk(15, 45), 10, 10,
      fast.id, km.id, Math.round(km.prawd_start / 2), 'otwarty', dniTemu(calk(30, 90)));
  const tid = Number(r.lastInsertRowid);
  let dz = calk(3, 14);
  wstawWejscie.run(tid, km.id, dniTemu(dz));
  for (const wcz of kamFast.filter(x => x.kolejnosc < km.kolejnosc).reverse()) {
    dz += calk(15, 40);
    wstawWejscie.run(tid, wcz.id, dniTemu(dz));
    wstawPotw.run(tid, wcz.id, dniTemu(dz - 5), `Potwierdzone (demo): ${wcz.nazwa}`, 'K. Latoś');
    for (const kr of db.prepare('SELECT id FROM kamien_kryteria WHERE kamien_id = ? AND aktywny = 1').all(wcz.id)) {
      db.prepare('INSERT OR IGNORE INTO kryteria_odhaczenia (temat_id, kryterium_id, kto, data) VALUES (?,?,?,?)')
        .run(tid, kr.id, 'K. Latoś', dniTemu(dz - 5));
    }
  }
});
// AM: jeszcze 6 kont powracajacych z planem opieki (2 zalegle)
klienci.slice(3, 9).forEach((k, idx) => {
  db.prepare('UPDATE klienci SET klient_powracajacy = 1, data_nastepnego_przegladu = ? WHERE id = ?')
    .run(idx < 2 ? dataTemu(calk(5, 30)) : dataTemu(-calk(10, 90)), k.id);
});
console.log('5. Fast-track + AM gotowe');

// ---------- 6. Decyzje komitetu (historia bramki) ----------
for (let d = 0; d < 32; d++) {
  const dec = d < 20 ? 'bid' : d < 29 ? 'no_bid' : 'defer';
  db.prepare('INSERT INTO decyzje_komitetu (lead_id, decyzja, powod, uzasadnienie, data) VALUES (NULL,?,?,?,?)')
    .run(dec, dec === 'bid' ? null : los(['Zły marżowo', 'Konkurencja', 'Zły moment']),
      'Demo: posiedzenie Komitetu', dniTemu(calk(10, 300)));
}

// ---------- 7. Cele: urealnij ----------
db.prepare('DELETE FROM cele').run();
db.prepare(`INSERT INTO cele (okres, handlowiec, przychod_wazony, marza, wygrane, tematy_komitet) VALUES
  ('2026Q3','K. Latoś',110,10,3,6), ('2026Q3','P. Kowalski',40,3.5,1,3), ('2026','K. Latoś',380,34,10,20)`).run();

// wygrane w Q3: przesun 2 wygrane demo na ostatnie 30 dni + potwierdzenia M5 w Q3
const wygraneDemo = db.prepare(`SELECT id, handlowiec FROM tematy WHERE status='wygrany' AND tagi='demo' LIMIT 3`).all();
wygraneDemo.forEach((t, idx) => {
  db.prepare(`UPDATE tematy SET handlowiec = ? WHERE id = ?`).run(idx < 2 ? 'K. Latoś' : 'P. Kowalski', t.id);
  db.prepare(`UPDATE historia_tematu SET data = ? WHERE temat_id = ? AND typ_zmiany = 'zamkniecie'`)
    .run(dniTemu(calk(5, 28)), t.id);
  const m5 = kamStd.find(k => k.kod === 'M5');
  db.prepare(`UPDATE potwierdzenia_kamieni SET data = ? WHERE temat_id = ? AND kamien_id = ?`)
    .run(dniTemu(calk(30, 55)), t.id, m5.id);
});
console.log('6-7. Komitet + cele gotowe');

console.log('== DEMO SEED done ==');
