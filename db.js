// Warstwa bazy danych WPIP CRM - node:sqlite (wbudowane w Node 24)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Na Railway ustaw DATA_DIR na sciezke wolumenu (np. /data), inaczej baza znika przy deployu
const DATA_DIR = process.env.DATA_DIR || __dirname;
export const db = new DatabaseSync(path.join(DATA_DIR, 'wpip-crm.sqlite'));

db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS klienci (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  nip TEXT,
  zrodlo_pozyskania TEXT,
  klient_powracajacy INTEGER DEFAULT 0,
  opiekun TEXT,
  branza TEXT,
  miasto TEXT,
  wojewodztwo TEXT,
  potencjal_oze TEXT DEFAULT 'nie oceniono',
  dyskwalifikacja INTEGER DEFAULT 0,
  powod_dyskwalifikacji TEXT,
  notatki TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS osoby (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  klient_id INTEGER REFERENCES klienci(id) ON DELETE CASCADE,
  imie_nazwisko TEXT NOT NULL,
  stanowisko TEXT,
  email TEXT,
  telefon TEXT,
  rola_w_decyzji TEXT,
  notatki TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inwestycje (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  opis TEXT,
  typ_inwestora TEXT,
  co_powstaje TEXT,
  branza TEXT,
  wojewodztwo TEXT,
  miasto TEXT,
  wartosc_inwestycji REAL,
  powierzchnia REAL,
  etap_projektu TEXT,
  zrodlo TEXT,
  id_zrodlowe TEXT,
  data_pozyskania TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Wersja scoringu = odpowiednik arkusza Parametry (wagi + progi, wersjonowane)
-- Wersja uzyta do przeliczenia jakiejkolwiek grupy zostaje zamrozona (audyt).
CREATE TABLE IF NOT EXISTS wersje_scoringu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  opis TEXT,
  status TEXT DEFAULT 'robocza',
  prog_a INTEGER DEFAULT 85,
  prog_b INTEGER DEFAULT 70,
  prog_c INTEGER DEFAULT 55,
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Opcje komponentow wersji: A, B, C, D, E1, E2, E3, F (etykieta -> punkty, flaga X)
CREATE TABLE IF NOT EXISTS wersja_opcje (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wersja_id INTEGER REFERENCES wersje_scoringu(id) ON DELETE CASCADE,
  komponent TEXT NOT NULL,
  etykieta TEXT NOT NULL,
  punkty INTEGER NOT NULL,
  dyskwalifikacja INTEGER DEFAULT 0,
  kolejnosc INTEGER DEFAULT 0
);

-- Grupa leadow = jedna zaladowana baza (v1-v6); ma przypisana wersje scoringu
CREATE TABLE IF NOT EXISTS grupy_leadow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  opis TEXT,
  zrodlo TEXT,
  wersja_id INTEGER REFERENCES wersje_scoringu(id),
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Lead prospectingowy: os "% szansy na kwalifikacje" (NIE mylic z % wygranej tematu)
-- wybory = JSON {komponent: etykieta} - selekcje scoringu, punkty liczone z wersji
CREATE TABLE IF NOT EXISTS leady (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  klient_id INTEGER REFERENCES klienci(id),
  inwestycja_id INTEGER REFERENCES inwestycje(id),
  osoba_id INTEGER REFERENCES osoby(id),
  grupa_id INTEGER REFERENCES grupy_leadow(id),
  wersja_id INTEGER REFERENCES wersje_scoringu(id),
  handlowiec TEXT,
  zrodlo TEXT,
  kamien TEXT DEFAULT 'Lead surowy',
  prawd_kwalifikacji INTEGER DEFAULT 10,
  wybory TEXT DEFAULT '{}',
  score_total INTEGER DEFAULT 0,
  priorytet TEXT DEFAULT 'D',
  dyskwalifikacja_x INTEGER DEFAULT 0,
  dyskwalifikacja_powod TEXT,
  status_researchu TEXT DEFAULT 'SZARY',
  research_notatka TEXT,
  pwe TEXT,
  dobry_powod_kontaktu TEXT,
  status TEXT DEFAULT 'aktywny',
  powod_odpuszczenia TEXT,
  temat_id INTEGER,
  notatki TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Wystapienia leada w kolejnych grupach (naklady baz: lubelskie w v1, v4, v5)
CREATE TABLE IF NOT EXISTS lead_wystapienia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leady(id) ON DELETE CASCADE,
  grupa_id INTEGER REFERENCES grupy_leadow(id),
  data TEXT DEFAULT (datetime('now')),
  notatka TEXT
);

-- Historia zmian leada - sledzenie priorytetu w czasie, reklasyfikacje, kamienie, statusy
CREATE TABLE IF NOT EXISTS historia_leada (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leady(id) ON DELETE CASCADE,
  data TEXT DEFAULT (datetime('now')),
  typ_zmiany TEXT NOT NULL,
  wartosc_przed TEXT,
  wartosc_po TEXT,
  opis TEXT
);

-- Decyzje Komitetu Ofertowego (bramka bid / no bid / defer)
CREATE TABLE IF NOT EXISTS decyzje_komitetu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leady(id),
  temat_id INTEGER,
  data TEXT DEFAULT (datetime('now')),
  decyzja TEXT NOT NULL,
  powod TEXT,
  uzasadnienie TEXT
);

-- Karta ratingu prawdopodobienstwa = odrebny obiekt konfigurowalny (nie pola tematu)
CREATE TABLE IF NOT EXISTS karty_ratingu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  opis TEXT,
  aktywna INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS kamienie_karty (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  karta_id INTEGER REFERENCES karty_ratingu(id) ON DELETE CASCADE,
  kolejnosc INTEGER NOT NULL,
  nazwa TEXT NOT NULL,
  prawd_start INTEGER NOT NULL,
  prawd_min INTEGER NOT NULL,
  prawd_max INTEGER NOT NULL
);

-- Temat sprzedazowy (szansa) - identyfikator Inwestor_TypInwestycji na cale zycie tematu
CREATE TABLE IF NOT EXISTS tematy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identyfikator TEXT NOT NULL UNIQUE,
  nazwa TEXT,
  klient_id INTEGER REFERENCES klienci(id),
  inwestycja_id INTEGER REFERENCES inwestycje(id),
  osoba_id INTEGER REFERENCES osoby(id),
  handlowiec TEXT,
  zrodlo TEXT,
  model_realizacji TEXT,
  co_budujemy TEXT,
  data_startu TEXT,
  wartosc_kontraktu REAL DEFAULT 0,
  marza_pct REAL DEFAULT 9,
  termin_oferty TEXT,
  termin_realizacji TEXT,
  czas_trwania_mies INTEGER DEFAULT 12,
  karta_id INTEGER REFERENCES karty_ratingu(id),
  kamien_id INTEGER REFERENCES kamienie_karty(id),
  prawdopodobienstwo INTEGER DEFAULT 5,
  korekta_reczna INTEGER DEFAULT 0,
  status TEXT DEFAULT 'otwarty',
  czy_bierzemy TEXT DEFAULT 'ofertujemy',
  powod_odpuszczenia TEXT,
  przyczyna_zamkniecia TEXT,
  przyczyna_opis TEXT,
  notatki TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Dzialania outcome-driven: cel = rezultat do uzyskania OD KLIENTA, nie czynnosc handlowca
CREATE TABLE IF NOT EXISTS dzialania (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  typ TEXT,
  cel TEXT NOT NULL,
  opis TEXT,
  lead_id INTEGER REFERENCES leady(id),
  temat_id INTEGER REFERENCES tematy(id),
  klient_id INTEGER REFERENCES klienci(id),
  osoba_id INTEGER REFERENCES osoby(id),
  kamien_id INTEGER REFERENCES kamienie_karty(id),
  termin TEXT,
  wynik TEXT,
  delta_zastosowana INTEGER DEFAULT 0,
  status TEXT DEFAULT 'planowane',
  notatki TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Historia zmian tematu - audyt kamieni, prawdopodobienstwa, statusow
CREATE TABLE IF NOT EXISTS historia_tematu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  temat_id INTEGER REFERENCES tematy(id) ON DELETE CASCADE,
  data TEXT DEFAULT (datetime('now')),
  typ_zmiany TEXT NOT NULL,
  wartosc_przed TEXT,
  wartosc_po TEXT,
  opis TEXT
);

-- Slowniki edytowalne przez biznes (bez programisty)
CREATE TABLE IF NOT EXISTS slowniki (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  typ TEXT NOT NULL,
  wartosc TEXT NOT NULL,
  delta INTEGER,
  kolejnosc INTEGER DEFAULT 0,
  aktywny INTEGER DEFAULT 1
);

-- Uzytkownicy (logowanie) + konfiguracja techniczna (sekret sesji)
CREATE TABLE IF NOT EXISTS uzytkownicy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  haslo_hash TEXT NOT NULL,
  imie TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS konfiguracja (
  klucz TEXT PRIMARY KEY,
  wartosc TEXT
);
`);

// ---------- SEED (tylko przy pustej bazie) ----------
const kartCount = db.prepare('SELECT COUNT(*) c FROM karty_ratingu').get().c;
if (kartCount === 0) {
  const insKarta = db.prepare('INSERT INTO karty_ratingu (nazwa, opis) VALUES (?, ?)');
  const kartaId = insKarta.run('Standardowy proces GW',
    'Wartości startowe z arkusza Pipeline_WPIP_v3. 6 kamieni milowych, awans = decyzja handlowca.').lastInsertRowid;

  const insKamien = db.prepare(
    'INSERT INTO kamienie_karty (karta_id, kolejnosc, nazwa, prawd_start, prawd_min, prawd_max) VALUES (?,?,?,?,?,?)');
  [
    [1, 'Lead', 5, 0, 10],
    [2, 'Wstępna kwalifikacja', 15, 11, 25],
    [3, 'Oferta złożona', 35, 26, 50],
    [4, 'Preferowany wykonawca', 65, 51, 80],
    [5, 'Decyzja biznesowa', 90, 81, 99],
    [6, 'Umowa podpisana', 100, 100, 100],
  ].forEach(k => insKamien.run(kartaId, ...k));

  const insSl = db.prepare('INSERT INTO slowniki (typ, wartosc, delta, kolejnosc) VALUES (?,?,?,?)');
  // Powody odpuszczenia (bramka pre-kwalifikacyjna + Komitet + odpuszczenie leada)
  ['Zły marżowo', 'Brak dopasowania', 'Zły moment', 'Konkurencja', 'Ryzyko biznesowe', 'Research negatywny (CZERWONY)', 'Inne']
    .forEach((w, i) => insSl.run('powod_odpuszczenia', w, null, i));
  // Przyczyny wygranej
  ['Cena', 'Relacja', 'Dopasowanie techniczne', 'Termin', 'Referencje', 'Rekomendacja', 'Inne']
    .forEach((w, i) => insSl.run('przyczyna_wygranej', w, null, i));
  // Przyczyny przegranej
  ['Cena', 'Referencje konkurencji', 'Relacja konkurenta', 'Czas dostawy', 'Dopasowanie techniczne', 'Rezygnacja klienta z projektu', 'Inne']
    .forEach((w, i) => insSl.run('przyczyna_przegranej', w, null, i));
  // Wyniki dzialan -> delta prawdopodobienstwa w obrebie kamienia
  [['Osiągnięty', 3], ['Częściowo', 1], ['Zwłoka', -1], ['Nieosiągnięty', -3]]
    .forEach(([w, d], i) => insSl.run('wynik_dzialania', w, d, i));
  // Modele realizacji
  ['Generalne wykonawstwo', 'Zaprojektuj i buduj', 'Wykonawstwo', 'Inwestor zastępczy', 'Inne']
    .forEach((w, i) => insSl.run('model_realizacji', w, null, i));
  // Zrodla leadow (CRM niezalezny od konkretnego zrodla)
  ['Baza sygnałów (KI)', 'Rekomendacja klienta', 'Research własny', 'Przetarg', 'Marketing', 'Klient powracający', 'Wydarzenie (np. THE CIRCLE)', 'Inne']
    .forEach((w, i) => insSl.run('zrodlo_leada', w, null, i));
  // Typy dzialan
  ['Telefon', 'E-mail', 'Spotkanie', 'Wizyta w Jasinie', 'LinkedIn', 'Konferencja / targi', 'Research (KRS/web)', 'Inne']
    .forEach((w, i) => insSl.run('typ_dzialania', w, null, i));
  // Sciezka procesu pozyskania tematu (kamienie prospectingu, z Research po imporcie)
  ['Lead surowy', 'Research', 'Lead wzbogacony', 'Pierwszy kontakt', 'Kontakt odpowiedział', 'Rozmowa poznawcza', 'Zakwalifikowany']
    .forEach((w, i) => insSl.run('kamien_prospectingu', w, null, i));
  // Buyer persony (wstepny model - formalne po warsztacie 3)
  ['Persona 1 - Industrial Manufacturing', 'Persona 2 - Pharma / Biotech', 'Persona 3 - Proxy Investor']
    .forEach((w, i) => insSl.run('buyer_persona', w, null, i));
  // Miasta referencyjne WPIP (komponent E3 - bliskosc geograficzna; lista edytowalna,
  // docelowo pelne ~100 miast z parsowania PDF referencji)
  ['Jasin', 'Poznań', 'Swarzędz', 'Środa Śląska', 'Polkowice', 'Słubice', 'Nowa Sól', 'Iława',
   'Batorowo', 'Międzyzdroje', 'Gdynia', 'Bydgoszcz', 'Warszawa']
    .forEach((w, i) => insSl.run('miasto_referencyjne', w, null, i));
}

// ---------- SEED wersji scoringu v6 (progi 85/70/55 - decyzja z 08.07.2026) ----------
const wersjeCount = db.prepare('SELECT COUNT(*) c FROM wersje_scoringu').get().c;
if (wersjeCount === 0) {
  const wersjaId = db.prepare(
    `INSERT INTO wersje_scoringu (nazwa, opis, status, prog_a, prog_b, prog_c) VALUES (?,?,?,?,?,?)`)
    .run('v6 — baza startowa',
      'Metodologia z dokumentu scoring_leadow_podsumowanie (iteracje v1-v6 na 1200+ inwestycjach). Progi priorytetów 85/70/55 wg kompendium.',
      'robocza', 85, 70, 55).lastInsertRowid;

  const ins = db.prepare(
    'INSERT INTO wersja_opcje (wersja_id, komponent, etykieta, punkty, dyskwalifikacja, kolejnosc) VALUES (?,?,?,?,?,?)');

  // A. Typologia obiektu (max 30)
  [['Zakłady produkcyjne', 30], ['Magazyny / centra logistyczne', 18], ['Biurowce', 8],
   ['Hotele / pensjonaty', 8], ['Handel', 5]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'A', e, p, 0, i));

  // B. Wartosc inwestycji (max 25) - sweet spot 30-60 mln
  [['30-60 mln PLN (sweet spot)', 25], ['20-30 mln PLN', 18], ['60-80 mln PLN', 18],
   ['15-20 mln PLN', 10], ['80-100 mln PLN', 10], ['Poza przedziałami (<15 lub >100)', 3],
   ['Brak danych o wartości', 0]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'B', e, p, 0, i));

  // C. Profil inwestora (max 25) - 3 klasy dyskwalifikujace
  [['Polska firma operacyjna / mid-market', 25, 0], ['SSE z operatorem', 18, 0],
   ['Korporacja zagraniczna', 15, 0], ['Sama strefa (bez operatora)', 8, 0],
   ['Deweloper magazynowy', 5, 0],
   ['CTP', 0, 1], ['Firma z własnym GW w grupie', 0, 1], ['Publiczny / wojskowy', 0, 1]]
    .forEach(([e, p, d], i) => ins.run(wersjaId, 'C', e, p, d, i));

  // D. Etap procesu inwestycyjnego (max 15)
  [['Wybór generalnego wykonawcy', 15], ['Projektowanie zakończone', 12], ['Projektowanie', 10],
   ['Wybór głównego projektanta', 7], ['Wizja', 5], ['Zapowiedź inwestycji', 4], ['Budowa trwa', 0]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'D', e, p, 0, i));

  // E1. Lokalizacja (max 10) - neutralna od v4 (odleglosc = koszt operacyjny, nie filtr)
  [['Województwo objęte bazą', 10]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'E1', e, p, 0, i));

  // E2. Branza z portfolio WPIP (max 10) - wagi wg liczby referencji (>=10 obiektow = max)
  [['Motoryzacja', 10], ['Logistyka', 10], ['Poligrafia / opakowania', 10], ['Chemia / farmacja', 10],
   ['Spożywcza', 10], ['Przemysł', 10], ['Elektryka', 5], ['Dom / wnętrze', 5], ['Odzież', 5],
   ['Meble', 5], ['Hotele', 3], ['Inna / brak dopasowania', 0]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'E2', e, p, 0, i));

  // E3. Bliskosc geograficzna do realizacji WPIP (max 5)
  [['Miasto z realizacją WPIP', 5], ['Powiat z realizacją WPIP', 3], ['Brak bliskości', 0]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'E3', e, p, 0, i));

  // F. Bonus rozbudowa (max 5)
  [['Rozbudowa istniejącego zakładu', 5], ['Nowa inwestycja', 0]]
    .forEach(([e, p], i) => ins.run(wersjaId, 'F', e, p, 0, i));
}

export const KOMPONENTY = ['A', 'B', 'C', 'D', 'E1', 'E2', 'E3', 'F'];
export const NAZWY_KOMPONENTOW = {
  A: 'A. Typologia obiektu', B: 'B. Wartość inwestycji', C: 'C. Profil inwestora',
  D: 'D. Etap procesu inwestycyjnego', E1: 'E1. Lokalizacja', E2: 'E2. Branża z portfolio WPIP',
  E3: 'E3. Bliskość geograficzna', F: 'F. Bonus rozbudowa',
};
