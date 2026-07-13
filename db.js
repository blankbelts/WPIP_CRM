// Warstwa bazy danych WPIP CRM - node:sqlite (wbudowane w Node 24)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedPipeline } from './seed-pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Na Railway ustaw DATA_DIR na sciezke wolumenu (np. /data), inaczej baza znika przy deployu
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
console.log('Baza danych:', path.join(DATA_DIR, 'wpip-crm.sqlite'));
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

-- Pytania kwalifikacji wstepnej (szybka triage 5-7 pytan, edytowalne)
CREATE TABLE IF NOT EXISTS pytania_kwalifikacji (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tekst TEXT NOT NULL,
  kolejnosc INTEGER DEFAULT 0,
  dyskwalifikujace INTEGER DEFAULT 0,
  aktywny INTEGER DEFAULT 1
);

-- Partnerzy biznesowi (ambasadorzy, posrednicy, biura arch., inwestorzy zastepczy, zarzadcy)
CREATE TABLE IF NOT EXISTS partnerzy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa TEXT NOT NULL,
  typ TEXT,
  osoba_kontakt TEXT,
  email TEXT,
  telefon TEXT,
  etap TEXT DEFAULT 'Research',
  potencjal TEXT,
  notatki TEXT,
  utworzono TEXT DEFAULT (datetime('now'))
);

-- Pipeline v2: biblioteka zadan per kamien (TaskTemplate)
CREATE TABLE IF NOT EXISTS task_szablony (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kamien_id INTEGER REFERENCES kamienie_karty(id) ON DELETE CASCADE,
  nazwa TEXT NOT NULL,
  oczekiwany_efekt TEXT,
  co_dalej_sukces TEXT,
  co_dalej_porazka TEXT,
  typ TEXT,
  kolejnosc INTEGER DEFAULT 0,
  aktywny INTEGER DEFAULT 1
);

-- Potwierdzenie kamienia (MilestoneConfirmation) - jedyna droga awansu, fakt + dowod
CREATE TABLE IF NOT EXISTS potwierdzenia_kamieni (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  temat_id INTEGER REFERENCES tematy(id) ON DELETE CASCADE,
  kamien_id INTEGER REFERENCES kamienie_karty(id),
  data TEXT DEFAULT (datetime('now')),
  dowod TEXT,
  potwierdzajacy TEXT
);

-- Wejscia tematu w kamienie - do liczenia czasu w etapie i zastygniecia
CREATE TABLE IF NOT EXISTS milestone_wejscia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  temat_id INTEGER REFERENCES tematy(id) ON DELETE CASCADE,
  kamien_id INTEGER REFERENCES kamienie_karty(id),
  data_wejscia TEXT DEFAULT (datetime('now'))
);

-- Powody zamkniecia per kamien (CloseReason) z flaga recyklingu i offsetem powrotu
CREATE TABLE IF NOT EXISTS powody_zamkniecia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kamien_kod TEXT,
  nazwa TEXT NOT NULL,
  czy_recyklingowalny INTEGER DEFAULT 0,
  offset_powrotu_mies INTEGER DEFAULT 0,
  aktywny INTEGER DEFAULT 1
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
    [5, 'Decyzja biznesowa', 88, 81, 95],
    [6, 'Kontraktacja', 97, 96, 99],
    [7, 'Umowa podpisana', 100, 100, 100],
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
  // Sciezka pozyskania tematu (wg doprecyzowania 12.07.2026):
  // szybka kwalifikacja wstepna -> (interesujace) gleboki scoring z researchem -> Komitet
  ['Lead surowy', 'Kwalifikacja wstępna', 'Research', 'Scoring', 'Zakwalifikowany']
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

// ---------- MIGRACJA (idempotentna, dziala na istniejacej i swiezej bazie) ----------
function dodajKolumne(tabela, kolumna, typ) {
  const kolumny = db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);
  if (!kolumny.includes(kolumna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${kolumna} ${typ}`);
}

function seedSlownikJesliBrak(typ, wartosci) {
  const jest = db.prepare('SELECT COUNT(*) c FROM slowniki WHERE typ = ?').get(typ).c;
  if (jest > 0) return;
  const ins = db.prepare('INSERT INTO slowniki (typ, wartosc, kolejnosc) VALUES (?,?,?)');
  wartosci.forEach((w, i) => ins.run(typ, w, i));
}

(function migruj() {
  // Nowe pola leada (proces pozyskania tematu + integracja E2E / Intense)
  dodajKolumne('leady', 'identyfikator', 'TEXT');           // wspolne ID tematu (od leada po ZOS)
  dodajKolumne('leady', 'sposob_pozyskania', 'TEXT');        // marketing/prospecting/AM/partner/Zarzad/polecenie
  dodajKolumne('leady', 'zrodlo_wiedzy_wpip', 'TEXT');       // skad klient wie o WPIP (dla wszystkich)
  dodajKolumne('leady', 'proces_researchu', 'TEXT');         // sciezka researchu przypisana w kwalifikacji wstepnej
  dodajKolumne('leady', 'kwalif_odpowiedzi', "TEXT DEFAULT '{}'"); // JSON {pytanie_id: tak/nie/?}
  dodajKolumne('leady', 'kwalif_wynik', 'TEXT');             // interesujacy / do decyzji / odpuszczony
  dodajKolumne('leady', 'scoring_potwierdzony', 'INTEGER DEFAULT 0'); // scoring A-F potwierdzony po researchu
  dodajKolumne('leady', 'fast_track', 'INTEGER DEFAULT 0');  // eskalacja / wyjatek od bramki (np. temat Zarzadu)
  dodajKolumne('leady', 'fast_track_powod', 'TEXT');

  // Statusy zwrotne z Intense na temacie (CRM czyta, nie edytuje procesu ofertowego)
  dodajKolumne('tematy', 'status_e2e', 'TEXT');
  dodajKolumne('tematy', 'wartosc_oferty', 'REAL');
  dodajKolumne('tematy', 'data_decyzji_zwrotnej', 'TEXT');
  dodajKolumne('tematy', 'powod_zwrotny', 'TEXT');

  // Pipeline v2 - persona/kamienie-fakty, recykling, powiazanie z leadem zrodlowym
  dodajKolumne('karty_ratingu', 'persona', 'TEXT');
  dodajKolumne('karty_ratingu', 'kod', 'TEXT');
  dodajKolumne('kamienie_karty', 'kod', 'TEXT');
  dodajKolumne('kamienie_karty', 'definicja_spelnienia', 'TEXT'); // opis dowodu spelnienia
  dodajKolumne('kamienie_karty', 'prog_zastygniecia_dni', 'INTEGER');
  dodajKolumne('kamienie_karty', 'wymiary_scoringu', 'TEXT');
  dodajKolumne('kamienie_karty', 'elastyczna_kolejnosc', 'INTEGER DEFAULT 0');
  dodajKolumne('dzialania', 'template_id', 'INTEGER');
  dodajKolumne('tematy', 'recycle_date', 'TEXT');
  dodajKolumne('tematy', 'lead_id', 'INTEGER');

  // Nowe slowniki (tylko jesli brak - nie klobruja edycji uzytkownika)
  seedSlownikJesliBrak('sposob_pozyskania',
    ['Marketing', 'Prospecting NB', 'Klient powracający (AM)', 'Partner', 'Zarząd', 'Polecenie']);
  seedSlownikJesliBrak('zrodlo_wiedzy_wpip',
    ['Polecenie / rekomendacja', 'Targi / konferencja', 'LinkedIn', 'Strona WWW WPIP', 'Prasa branżowa',
     'Wydarzenie (np. THE CIRCLE)', 'Wcześniejsza realizacja', 'Wyszukiwarka', 'Inne']);
  seedSlownikJesliBrak('proces_researchu',
    ['New Business — produkcja', 'Deweloper magazynowy (trudny rynek)', 'Klient powracający — rozbudowa',
     'Farmacja / biotech', 'Inwestor zastępczy / proxy']);
  seedSlownikJesliBrak('status_e2e',
    ['Kick-off oferty', 'Przygotowanie oferty', 'Komitet Cenowy', 'Akceptacja Zarządu',
     'Oferta wysłana', 'Rewizja', 'Wygrana', 'Przegrana']);
  seedSlownikJesliBrak('typ_partnera',
    ['Ambasador', 'Pośrednik', 'Biuro architektoniczne', 'Inwestor zastępczy', 'Zarządca nieruchomości', 'Inny']);
  seedSlownikJesliBrak('etap_partnera',
    ['Research', 'Weryfikacja telefoniczna', 'Spotkanie', 'Profil w bazie (aktywny)', 'Odrzucony']);

  // Powod odpuszczenia: dodaj wpis dla negatywnej kwalifikacji wstepnej
  const maKwalif = db.prepare(`SELECT COUNT(*) c FROM slowniki WHERE typ='powod_odpuszczenia' AND wartosc='Kwalifikacja wstępna negatywna'`).get().c;
  if (!maKwalif) {
    db.prepare(`INSERT INTO slowniki (typ, wartosc, kolejnosc) VALUES ('powod_odpuszczenia','Kwalifikacja wstępna negatywna', 10)`).run();
  }

  // Reset sciezki na nowy zestaw TYLKO gdy to jeszcze stary zestaw (migracja jednorazowa)
  const STARE = ['Lead surowy', 'Research', 'Lead wzbogacony', 'Pierwszy kontakt', 'Kontakt odpowiedział', 'Rozmowa poznawcza', 'Zakwalifikowany'];
  const NOWE = ['Lead surowy', 'Kwalifikacja wstępna', 'Research', 'Scoring', 'Zakwalifikowany'];
  const obecne = db.prepare(`SELECT wartosc FROM slowniki WHERE typ='kamien_prospectingu' AND aktywny=1 ORDER BY kolejnosc`).all().map(r => r.wartosc);
  const jestStary = obecne.length === STARE.length && obecne.every((w, i) => w === STARE[i]);
  if (jestStary) {
    db.prepare(`DELETE FROM slowniki WHERE typ='kamien_prospectingu'`).run();
    const ins = db.prepare(`INSERT INTO slowniki (typ, wartosc, kolejnosc) VALUES ('kamien_prospectingu', ?, ?)`);
    NOWE.forEach((w, i) => ins.run(w, i));
    // Przenies leady ze zlikwidowanych kamieni na najblizszy sensowny
    const mapa = { 'Lead wzbogacony': 'Research', 'Pierwszy kontakt': 'Scoring', 'Kontakt odpowiedział': 'Scoring', 'Rozmowa poznawcza': 'Scoring' };
    for (const [z, na] of Object.entries(mapa)) {
      db.prepare('UPDATE leady SET kamien = ? WHERE kamien = ?').run(na, z);
    }
  }

  // Backfill wspolnego ID tematu + sposobu pozyskania dla leadow sprzed tej zmiany
  const bezId = db.prepare(`SELECT l.id, l.nazwa, l.wybory, l.zrodlo, k.nazwa AS klient
    FROM leady l LEFT JOIN klienci k ON k.id = l.klient_id WHERE l.identyfikator IS NULL`).all();
  if (bezId.length) {
    const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(sp\.?\s*z\s*o\.?\s*o\.?|s\.?a\.?|sp\.?j\.?|s\.?k\.?a\.?)\b/gi, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 2).join('');
    const upd = db.prepare('UPDATE leady SET identyfikator = ?, sposob_pozyskania = COALESCE(sposob_pozyskania, ?) WHERE id = ?');
    for (const l of bezId) {
      let typ = 'inwestycja';
      try { typ = slug(JSON.parse(l.wybory || '{}').A) || 'inwestycja'; } catch {}
      const id = `${slug(l.klient || l.nazwa) || 'Temat'}_${typ}_${l.id}`;
      const sposob = (l.zrodlo || '').includes('KI') ? 'Prospecting NB' : null;
      upd.run(id, sposob, l.id);
    }
  }

  // Etap Kontraktacja miedzy Decyzja biznesowa a Umowa podpisana (dla istniejacych kart)
  for (const karta of db.prepare('SELECT id FROM karty_ratingu').all()) {
    const ma = db.prepare(`SELECT COUNT(*) c FROM kamienie_karty WHERE karta_id=? AND nazwa='Kontraktacja'`).get(karta.id).c;
    const umowa = db.prepare(`SELECT * FROM kamienie_karty WHERE karta_id=? AND nazwa='Umowa podpisana'`).get(karta.id);
    if (!ma && umowa) {
      db.prepare('UPDATE kamienie_karty SET kolejnosc = kolejnosc + 1 WHERE id = ?').run(umowa.id);
      db.prepare(`INSERT INTO kamienie_karty (karta_id, kolejnosc, nazwa, prawd_start, prawd_min, prawd_max)
        VALUES (?,?,?,?,?,?)`).run(karta.id, umowa.kolejnosc, 'Kontraktacja', 97, 96, 99);
      db.prepare(`UPDATE kamienie_karty SET prawd_max=95, prawd_start=88 WHERE karta_id=? AND nazwa='Decyzja biznesowa'`).run(karta.id);
    }
  }
})();

// Seed pipeline v2 (STANDARD M1-M8 + FAST-TRACK F1-F4) - po migracji kolumn
seedPipeline(db);

// ---------- SEED pytan kwalifikacji wstepnej (5-7 pytan strategicznych) ----------
if (db.prepare('SELECT COUNT(*) c FROM pytania_kwalifikacji').get().c === 0) {
  const ins = db.prepare('INSERT INTO pytania_kwalifikacji (tekst, kolejnosc, dyskwalifikujace) VALUES (?,?,?)');
  [
    ['Brak twardej dyskwalifikacji (nie CTP, nie firma z własnym GW, nie zamówienie publiczne)?', 0, 1],
    ['Klient końcowy / polska firma operacyjna (nie deweloper spekulacyjny)?', 1, 0],
    ['Segment produkcyjny lub magazyn z komponentem produkcyjnym?', 2, 0],
    ['Wartość w zasięgu WPIP (ok. 10–150 mln PLN)?', 3, 0],
    ['Mamy przewagę (clean room, rozbudowa na żywym organizmie, OZE, instalacje własne, referencje w branży)?', 4, 0],
    ['Jest realny punkt zaczepienia / dobry powód kontaktu (PWE)?', 5, 0],
    ['Właściwy moment (jest pojemność ofertowa, brak konfliktu harmonogramowego)?', 6, 0],
  ].forEach(p => ins.run(...p));
}

export const KOMPONENTY = ['A', 'B', 'C', 'D', 'E1', 'E2', 'E3', 'F'];
export const NAZWY_KOMPONENTOW = {
  A: 'A. Typologia obiektu', B: 'B. Wartość inwestycji', C: 'C. Profil inwestora',
  D: 'D. Etap procesu inwestycyjnego', E1: 'E1. Lokalizacja', E2: 'E2. Branża z portfolio WPIP',
  E3: 'E3. Bliskość geograficzna', F: 'F. Bonus rozbudowa',
};
