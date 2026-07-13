// Seed pipeline v2 (STANDARD M1-M8, FAST-TRACK F1-F4) wg dokumentu
// Proces_sprzedazy_CRM_persona_produkcja_rodzinna_20mln.md. Uruchamiany raz (flaga w konfiguracji).
// Kamien = weryfikowalny FAKT po stronie klienta; do kazdego biblioteka zadan.

// [kod, nazwa-fakt, prawd%, prog_zastygniecia_dni, elastyczna, definicja dowodu, wymiary scoringu]
const STANDARD = [
  ['M1', 'Plany budowy potwierdzone w rozmowie z osobą prowadzącą temat', 10, 14, 0,
    'Notatka z rozmowy potwierdzająca realne plany + zgoda na kolejny kontakt', 'realność tematu, horyzont czasowy, kto prowadzi'],
  ['M2', 'Ramy inwestycji znane: lokalizacja/działka, wstępny budżet, termin', 20, 14, 0,
    'Wypełnione pola: status MPZP/WZ, powierzchnia, budżet widełkowo, termin startu', 'wielkość i wartość, status formalny, timing'],
  ['M3', 'Odbyte spotkanie z decydentem; znana struktura decyzyjna i model wyboru GW', 30, 21, 1,
    'Data spotkania z decydentem + wypełniona mapa decyzyjna (kto, konsultant/IZ, ilu oferentów)', 'dostęp do decydenta, proces zakupowy, konkurencja'],
  ['M4', 'Finansowanie i decyzja inwestycyjna potwierdzone', 40, 21, 1,
    'Znane źródło finansowania (środki/kredyt, etap z bankiem) + potwierdzenie decyzji "budujemy"', 'budżet realny, decyzja podjęta'],
  ['M5', 'Zaproszenie do oferty z kompletem danych = rejestracja ZOS → Komitet Ofertowy', 50, 21, 0,
    'Komplet briefu/PFU + decyzja BID Komitetu (rejestracja ZOS w Intense)', 'pełny scoring na Komitet'],
  ['M6', 'Oferta złożona i OMÓWIONA na spotkaniu (nie tylko wysłana)', 60, 30, 0,
    'Data spotkania omówienia oferty; znane kryteria porównania i pozycja vs konkurencja', 'etap procesu ofertowego E2E 6-12 (Intense)'],
  ['M7', 'Shortlista potwierdzona + wizyta referencyjna odbyta', 70, 30, 0,
    'Potwierdzenie shortlisty + data wizyty (showroom Jasin lub realizacja)', '—'],
  ['M8', 'Warunki brzegowe uzgodnione — jesteśmy w 1-2 finalistów', 85, 30, 0,
    'Lista rozbieżności zamknięta (zakres, harmonogram, model umowy, kary/gwarancje)', '—'],
  ['WYGRANA', 'Umowa podpisana → handover do realizacji', 100, 0, 0,
    'Podpisana umowa', '—'],
];

const FAST = [
  ['F1', 'Sygnał rozwojowy potwierdzony w rozmowie (potrzeba rozbudowy <24 mc)', 30, 90, 0,
    'Notatka z przeglądu konta potwierdzająca sygnał rozwojowy', 'realność, horyzont, historia współpracy'],
  ['F2', 'Ramy inwestycji + intencja kontynuacji potwierdzona przez decydenta', 50, 21, 0,
    'Potwierdzony zakres/budżet/termin + tryb (negocjacje 1:1 czy przetarg kontrolny)', 'wartość, timing, tryb wyboru'],
  ['F3', 'Zaproszenie do oferty / uzgodniony tryb = rejestracja ZOS + Komitet', 70, 21, 0,
    'Komplet danych do wyceny + decyzja BID (historia współpracy podnosi score)', 'pełny scoring na Komitet'],
  ['F4', 'Oferta omówiona + warunki uzgodnione', 85, 30, 0,
    'Prezentacja oferty + warsztat kontraktowy (harmonogram, kary, gwarancje)', '—'],
  ['WYGRANA', 'Umowa → handover', 100, 0, 0, 'Podpisana umowa', '—'],
];

// Biblioteka zadan: kod kamienia -> [ [nazwa, oczekiwany_efekt, co_dalej_sukces, co_dalej_porazka, typ] ]
const ZADANIA = {
  M1: [
    ['Telefon do osoby prowadzącej inwestycję/przetarg', 'Potwierdzone plany + zgoda na kolejną rozmowę', 'Umów rozmowę pogłębiającą (M2)', 'Wróć do researchu / ścieżki B', 'telefon'],
    ['Research firmy (KRS, strona, LinkedIn, prasa, rejestry WZ/pozwoleń)', 'Nazwisko osoby prowadzącej lub właściciela', 'Wyślij mail intro', 'Kontakt przez partnera / recepcję', 'research'],
    ['Mail intro z dobrym powodem kontaktu (sygnał + 1 wartość WPIP)', 'Odpowiedź / zgoda na telefon', 'Zadzwoń', 'Telefon przez sekretariat', 'mail'],
    ['Kontakt przez projektanta/architekta/partnera (Baza Partnerów)', 'Ciepłe wprowadzenie', 'Umów rozmowę', 'Spotkanie na targach', 'inne'],
    ['Spotkanie na targach / wydarzeniu branżowym', 'Rozmowa bezpośrednia', 'Potwierdź plany (M1)', 'Follow-up mailowy', 'spotkanie'],
  ],
  M2: [
    ['Rozmowa pogłębiająca wg checklisty (działka, MPZP/WZ, powierzchnia, technologia, budżet, termin)', 'Wypełnione pola scoringu w CRM', 'Umów spotkanie z decydentem (M3)', 'Doprecyzuj brakujące dane', 'telefon'],
    ['Weryfikacja działki i statusu formalnego (geoportal, rejestr decyzji)', 'Potwierdzenie/zaprzeczenie deklaracji', 'Przejdź do M3', 'Oznacz ryzyko formalne', 'research'],
    ['Mini-doradztwo: checklista "co musi być gotowe zanim GW policzy rzetelnie"', 'Klient dzieli się dokumentami', 'Zbierz dokumenty', 'Podtrzymaj kontakt', 'mail'],
  ],
  M3: [
    ['Zaproszenie właściciela na spotkanie z realizacjami z jego branży', 'Termin spotkania', 'Odbądź spotkanie, wypełnij mapę decyzyjną', 'Zaproponuj spotkanie właściciel-właściciel', 'spotkanie'],
    ['Karta "jak kupują": kto decyduje, kto doradza, ilu oferentów, kryteria', 'Wypełniona mapa decyzyjna w CRM', 'Przejdź do M4', 'Dopytaj przez konsultanta', 'research'],
    ['Propozycja spotkania właściciel-właściciel (zarząd WPIP)', 'Relacja na poziomie decyzyjnym', 'Buduj relację, M4', 'Utrzymaj kontakt operacyjny', 'spotkanie'],
    ['Osobna ścieżka relacji z inwestorem zastępczym (jeśli jest)', 'IZ zna i akceptuje WPIP jako oferenta', 'Przejdź do M4', 'Eskaluj relację', 'inne'],
  ],
  M4: [
    ['Rozmowa o modelu finansowania + oferta pomocy (dane do wniosku, harmonogram płatności, referencje dla banku)', 'Znane źródło i etap finansowania', 'Potwierdź decyzję inwestycyjną', 'Monitoruj etap kredytu', 'spotkanie'],
    ['Weryfikacja formalnego zatwierdzenia inwestycji (uchwała, budżet roczny)', 'Potwierdzenie decyzji "budujemy"', 'Przejdź do M5', 'Ustal termin decyzji', 'research'],
    ['Włączenie WPIP Green Energy (PV/pompy ciepła, PVaaS bez CAPEX)', 'Rozszerzenie zakresu rozmowy', 'Dołącz OZE do oferty', 'Zostaw jako opcję', 'inne'],
  ],
  M5: [
    ['Doprowadzenie do kompletności briefu (PFU, mapa, warunki)', 'Komplet danych, rejestracja ZOS', 'Wniosek na Komitet', 'Uzupełnij braki', 'inne'],
    ['Ustawienie kryteriów przetargu poza ceną (doświadczenie w rozbudowach, harmonogram, gwarancje, BHP)', 'Kryteria uwzględnione w zapytaniu', 'Złóż wniosek na Komitet', 'Renegocjuj kryteria', 'spotkanie'],
    ['Scoring na Komitet + wniosek (materiały 24 h przed)', 'Decyzja BID', 'Przejdź do M6 (ofertowanie)', 'NO-BID → zamknij z powodem', 'inne'],
  ],
  M6: [
    ['Umówienie prezentacji oferty z udziałem decydenta (nie mail!)', 'Spotkanie odbyte, znamy reakcję', 'Przejdź do M7', 'Follow-up wątpliwości', 'spotkanie'],
    ['Pytania o kryteria porównania i pozycję vs konkurencja', 'Wiemy z kim i czym konkurujemy', 'Dopasuj argumentację', 'Zbierz sygnały', 'telefon'],
    ['Follow-up z odpowiedziami na wątpliwości techniczne (branżyści wewnętrzni)', 'Wątpliwości zamknięte', 'Do shortlisty (M7)', 'Eskaluj technicznie', 'mail'],
  ],
  M7: [
    ['Zaproszenie do showroomu Jasin (LEED Platinum, WELL)', 'Wizyta odbyta', 'Przejdź do M8', 'Zaproponuj wizytę na realizacji', 'wizyta'],
    ['Wizyta na realizacji u podobnego klienta + rozmowa z klientem-referencją', 'Dowód społeczny właściciel-właściciel', 'Domknij shortlistę', 'Wzmocnij referencje', 'wizyta'],
    ['Przedstawienie zespołu realizacji (KP, KB — stabilna kadra >10 lat)', 'Zaufanie do wykonania', 'Przejdź do M8', 'Buduj relację', 'spotkanie'],
  ],
  M8: [
    ['Warsztat kontraktowy (harmonogram, etapowanie, kary, gwarancje, regres do podwykonawców)', 'Lista rozbieżności zamknięta', 'Finalizacja → WYGRANA', 'Renegocjuj warunki', 'warsztat'],
    ['Domknięcie tematów banku (dokumenty do uruchomienia kredytu)', 'Brak blokad finansowych', 'Podpisanie umowy', 'Wsparcie finansowania', 'inne'],
    ['Eskalacja zarządu WPIP do finalnej rundy', 'Decyzja klienta', 'WYGRANA', 'Analiza przegranej', 'spotkanie'],
  ],
  F1: [
    ['Kwartalny przegląd konta wg agendy (plany, wyniki, nowe kontrakty klienta)', 'Potwierdzony lub wykluczony sygnał', 'Przejdź do F2', 'Utrzymaj rytm opieki', 'spotkanie'],
    ['Wizyta na obiekcie / przegląd gwarancyjny / serwis jako pretekst', 'Rozmowa o planach', 'Zapisz sygnał', 'Kolejny przegląd', 'wizyta'],
    ['Monitoring sygnałów (wyniki finansowe, rekrutacje, zakup gruntu, prasa)', 'Powód kontaktu', 'Zadzwoń z powodem', 'Obserwuj dalej', 'research'],
    ['Proaktywna propozycja WPIP Green Energy (PV, pompy, magazyn, PVaaS)', 'Projekt pomostowy podtrzymujący relację', 'Osobny krótki pipeline OZE', 'Zostaw jako opcję', 'inne'],
    ['Warsztat roadmapy rozwoju zakładu 3-5 lat z pracownią projektową', 'WPIP współtworzy plan przed przetargiem', 'Przejdź do F2', 'Podtrzymaj kontakt', 'warsztat'],
  ],
  F2: [
    ['Spotkanie decyzyjne z lessons learned poprzedniego etapu (zamknięte usterki, dotrzymane terminy)', 'Potwierdzona wola kontynuacji', 'Przejdź do F3', 'Odbuduj zaufanie', 'spotkanie'],
    ['Spotkanie zarząd-zarząd / właściciel-właściciel', 'Intencja na poziomie decyzyjnym', 'Uzgodnij tryb (F3)', 'Utrzymaj relację', 'spotkanie'],
    ['Wstępna koncepcja / etapowanie z pracownią (Design-Build)', 'WPIP definiuje zakres', 'Przejdź do F3', 'Doprecyzuj zakres', 'warsztat'],
    ['Wsparcie finansowania (materiały dla banku, PVaaS bez CAPEX)', 'Usunięta bariera budżetowa', 'Przejdź do F3', 'Monitoruj finansowanie', 'inne'],
  ],
  F3: [
    ['Komplet danych do wyceny + uzgodnienie kryteriów i trybu', 'Komplet, rejestracja ZOS', 'Wniosek na Komitet', 'Uzupełnij dane', 'inne'],
    ['Wniosek na Komitet (scoring, historia współpracy podnosi score)', 'Decyzja BID', 'Przejdź do F4', 'NO-BID → zamknij z powodem', 'inne'],
  ],
  F4: [
    ['Prezentacja oferty na spotkaniu', 'Znana reakcja i pozycja', 'Warsztat kontraktowy', 'Follow-up', 'spotkanie'],
    ['Warsztat kontraktowy (harmonogram, kary, gwarancje, regres) + domknięcie finansowania', 'Warunki uzgodnione', 'WYGRANA', 'Renegocjuj', 'warsztat'],
  ],
};

// Powody zamkniecia per kamien: [kod, nazwa, recyklingowalny, offset_mies]
const POWODY = [
  ['M1', 'Brak planów (fałszywy sygnał)', 0, 0],
  ['M1', 'Plany >24 mc', 1, 6],
  ['M1', 'Nie da się dotrzeć do nikogo (po X próbach)', 1, 3],
  ['M1', 'Projekt poniżej progu (<10 mln)', 0, 0],
  ['M2', 'Budżet nierealny vs zakres', 0, 0],
  ['M2', 'Działka bez perspektywy formalnej >12 mc', 1, 6],
  ['M2', 'Temat zamrożony', 1, 6],
  ['M3', 'Brak dostępu do decydenta (gatekeeper blokuje)', 1, 3],
  ['M3', 'Decydent ma faworyta / GW "rodzinnego"', 0, 0],
  ['M3', 'Temat przejęty w całości przez wrogiego IZ', 0, 0],
  ['M4', 'Brak finansowania / odmowa banku', 1, 6],
  ['M4', 'Przesunięcie decyzji o rok+', 1, 12],
  ['M4', 'Zmiana priorytetów właściciela', 1, 6],
  ['M5', 'NO-BID (scoring)', 0, 0],
  ['M5', 'Przetarg ustawiony pod konkurenta', 0, 0],
  ['M5', 'Klient wybrał model "najpierw projekt osobno"', 1, 6],
  ['M6', 'Odpadliśmy cenowo', 0, 0],
  ['M6', 'Odpadliśmy zakresowo', 0, 0],
  ['M6', 'Klient zamroził przetarg', 1, 6],
  ['M7', 'Poza shortlistą (cena/relacja)', 0, 0],
  ['M7', 'Konkurent z mocniejszą referencją lokalną', 0, 0],
  ['M8', 'Przegrana w finale (cena/warunki)', 0, 0],
  ['M8', 'Klient odroczył podpisanie', 1, 3],
  // Fast-track
  ['F1', 'Brak planów rozwoju', 1, 6],
  ['F1', 'Przejęcie klienta przez grupę z własnym GW', 0, 0],
  ['F1', 'Zamrożenie inwestycji', 1, 6],
  ['F2', 'Zła historia ostatniego etapu (usterki, spory)', 0, 0],
  ['F2', 'Decyzja o szerokim przetargu z faworytem cenowym', 0, 0],
  ['F3', 'NO-BID', 0, 0],
  ['F3', 'Przegrana w przetargu kontrolnym', 0, 0],
  ['F4', 'Cena vs konkurent', 0, 0],
  ['F4', 'Przesunięcie inwestycji', 1, 6],
];

export function seedPipeline(db) {
  const flaga = db.prepare(`SELECT wartosc FROM konfiguracja WHERE klucz = 'pipeline_v2_seed'`).get();
  if (flaga) return;

  const insKarta = db.prepare('INSERT INTO karty_ratingu (nazwa, opis, persona, kod) VALUES (?,?,?,?)');
  const insKamien = db.prepare(`INSERT INTO kamienie_karty
    (karta_id, kolejnosc, nazwa, kod, prawd_start, prawd_min, prawd_max, prog_zastygniecia_dni, elastyczna_kolejnosc, definicja_spelnienia, wymiary_scoringu)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insZad = db.prepare(`INSERT INTO task_szablony
    (kamien_id, nazwa, oczekiwany_efekt, co_dalej_sukces, co_dalej_porazka, typ, kolejnosc) VALUES (?,?,?,?,?,?,?)`);
  const insPow = db.prepare('INSERT INTO powody_zamkniecia (kamien_kod, nazwa, czy_recyklingowalny, offset_powrotu_mies) VALUES (?,?,?,?)');

  function zbuduj(nazwaPipe, opis, persona, kod, kamienie) {
    const kartaId = Number(insKarta.run(nazwaPipe, opis, persona, kod).lastInsertRowid);
    kamienie.forEach((k, i) => {
      const [kodK, nazwa, prawd, prog, elast, dowod, wymiary] = k;
      // zakres min/max kamienia = od prawd poprzedniego (+1) do wlasnego prawd
      const prawdMin = i === 0 ? 0 : kamienie[i - 1][2] + 1;
      const kamienId = Number(insKamien.run(kartaId, i + 1, nazwa, kodK, prawd, prawdMin, prawd, prog || null, elast, dowod, wymiary).lastInsertRowid);
      for (const [j, z] of (ZADANIA[kodK] || []).entries()) {
        insZad.run(kamienId, z[0], z[1], z[2], z[3], z[4], j);
      }
    });
  }

  zbuduj('STANDARD — produkcja rodzinna ~20 mln', 'Nowy klient, polska firma produkcyjna rodzinna, budowa/rozbudowa ~20 mln PLN.',
    'Produkcja rodzinna', 'STANDARD', STANDARD);
  zbuduj('FAST-TRACK — klient powracający', 'Konto w Account Management, sygnał w żywej relacji (80% sprzedaży, 75% przychodu).',
    'Klient powracający', 'FAST_TRACK', FAST);

  for (const p of POWODY) insPow.run(p[0], p[1], p[2], p[3]);

  db.prepare(`INSERT INTO konfiguracja (klucz, wartosc) VALUES ('pipeline_v2_seed', ?)`).run(new Date().toISOString());
}
