// Pipeline v3: rozdzielenie procesu wg ETAPU PROJEKTU INWESTORA.
//
// Jeden proces dla wszystkich tematow mieszal dwie populacje o zupelnie roznej
// dynamice. Inwestor z projektem i pozwoleniem wybiera GW w okolo pol roku;
// inwestor, ktory dopiero pracuje nad koncepcja, potrzebuje 12-18 miesiecy —
// bo po drodze musi powstac koncepcja, projekt i pozwolenie. Usredniona
// "12 miesiecy" nie opisywala zadnego z nich.
//
// Kazdy kamien dostaje czas_typowy_dni (ile etap trwa NORMALNIE). Suma po
// sciezce daje docelowa dlugosc cyklu, a porownanie z faktycznym czasem
// w etapie daje stan tematu i prognoze podpisania.
//
// [kod, nazwa-fakt, prawd%, prog_zastygniecia_dni, elastyczna, dowod, wymiary, czas_typowy_dni]

// ── Sciezka A: inwestor ma projekt i pozwolenie na budowe (~6 miesiecy) ───────
// Proces startuje blisko wyboru wykonawcy: nie ma fazy przedprojektowej,
// zakres wynika z dokumentacji, a decyzja inwestycyjna jest zwykle podjeta.
const PROJEKT_PNB = [
  ['P1', 'Plany budowy potwierdzone; projekt i pozwolenie po stronie inwestora', 15, 14, 0,
    'Notatka z rozmowy + potwierdzony numer/data pozwolenia lub wglad w dokumentacje', 'realnosc tematu, kompletnosc dokumentacji, kto prowadzi', 14],
  ['P2', 'Ramy inwestycji znane: zakres z dokumentacji, budzet, termin startu', 25, 14, 0,
    'Wypelnione pola: powierzchnia, technologia, budzet widelkowo, oczekiwany termin rozpoczecia', 'wielkosc i wartosc, timing', 14],
  ['P3', 'Odbyte spotkanie z decydentem; znany tryb wyboru GW i liczba oferentow', 35, 21, 1,
    'Data spotkania z decydentem + wypelniona mapa decyzyjna (kto decyduje, IZ/konsultant, ilu oferentow)', 'dostep do decydenta, proces zakupowy, konkurencja', 21],
  ['P4', 'Finansowanie i decyzja inwestycyjna potwierdzone', 45, 21, 1,
    'Znane zrodlo finansowania i jego etap + potwierdzenie decyzji "budujemy"', 'budzet realny, decyzja podjeta', 21],
  ['P5', 'Zaproszenie do oferty z kompletem dokumentacji = ZOS → Komitet Ofertowy', 55, 21, 0,
    'Komplet projektu wykonawczego/PFU + decyzja BID Komitetu (rejestracja ZOS w Intense)', 'pelny scoring na Komitet', 21],
  ['P6', 'Oferta zlozona i OMOWIONA na spotkaniu (nie tylko wyslana)', 65, 30, 0,
    'Data spotkania omowienia oferty; znane kryteria porownania i pozycja vs konkurencja', 'etap procesu ofertowego E2E (Intense)', 30],
  ['P7', 'Shortlista potwierdzona + wizyta referencyjna odbyta', 75, 30, 0,
    'Potwierdzenie shortlisty + data wizyty (showroom Jasin lub realizacja)', '—', 30],
  ['P8', 'Warunki brzegowe uzgodnione — jestesmy w 1-2 finalistow', 88, 30, 0,
    'Lista rozbieznosci zamknieta (zakres, harmonogram, model umowy, kary/gwarancje)', '—', 30],
  ['WYGRANA', 'Umowa podpisana → handover do realizacji', 100, 0, 0, 'Podpisana umowa', '—', 0],
];

// ── Sciezka B: brak projektu, praca nad koncepcja (12-18 miesiecy) ────────────
// Trzy kamienie wiecej niz sciezka A — to one odpowiadaja za roznice w czasie.
// WPIP wchodzi wczesniej, wiec ma szanse wspoltworzyc zakres, ale placi za to
// dlugoscia cyklu i wiekszym ryzykiem zamrozenia tematu.
const KONCEPCJA = [
  ['K1', 'Plany budowy potwierdzone w rozmowie z osoba prowadzaca temat', 5, 21, 0,
    'Notatka z rozmowy potwierdzajaca realne plany + zgoda na kolejny kontakt', 'realnosc tematu, horyzont czasowy, kto prowadzi', 21],
  ['K2', 'Ramy inwestycji: dzialka, status MPZP/WZ, wstepny budzet, horyzont', 10, 30, 0,
    'Wypelnione pola: status formalny dzialki, szacowana powierzchnia, budzet widelkowo, rok startu', 'wielkosc i wartosc, status formalny, timing', 30],
  ['K3', 'Koncepcja / program funkcjonalny uzgodniony z inwestorem', 15, 60, 0,
    'Zaakceptowany program funkcjonalny albo koncepcja ukladu (WPIP w roli wspolautora zakresu)', 'wplyw na zakres, dopasowanie technologiczne', 60],
  ['K4', 'Model realizacji ustalony: projektant wybrany albo Design-Build z WPIP', 22, 45, 0,
    'Decyzja inwestora o trybie: osobny projekt czy zaprojektuj-i-buduj; jesli osobny — znana pracownia', 'model realizacji, pozycja WPIP w procesie', 45],
  ['K5', 'Odbyte spotkanie z decydentem; znana struktura decyzyjna i tryb wyboru GW', 30, 30, 1,
    'Data spotkania z decydentem + wypelniona mapa decyzyjna', 'dostep do decydenta, proces zakupowy, konkurencja', 30],
  ['K6', 'Finansowanie i decyzja inwestycyjna potwierdzone', 40, 45, 1,
    'Znane zrodlo finansowania i etap (bank/srodki wlasne) + potwierdzenie decyzji "budujemy"', 'budzet realny, decyzja podjeta', 45],
  ['K7', 'Pozwolenie na budowe uzyskane albo wniosek zlozony', 48, 90, 0,
    'Numer/data wniosku lub decyzji o pozwoleniu na budowe', 'ryzyko formalne zdjete', 90],
  ['K8', 'Zaproszenie do oferty z kompletem danych = ZOS → Komitet Ofertowy', 55, 30, 0,
    'Komplet briefu/PFU + decyzja BID Komitetu (rejestracja ZOS w Intense)', 'pelny scoring na Komitet', 30],
  ['K9', 'Oferta zlozona i OMOWIONA na spotkaniu', 65, 30, 0,
    'Data spotkania omowienia oferty; znane kryteria porownania i pozycja vs konkurencja', 'etap procesu ofertowego E2E (Intense)', 30],
  ['K10', 'Shortlista potwierdzona + wizyta referencyjna odbyta', 75, 30, 0,
    'Potwierdzenie shortlisty + data wizyty (showroom Jasin lub realizacja)', '—', 30],
  ['K11', 'Warunki brzegowe uzgodnione — jestesmy w 1-2 finalistow', 85, 30, 0,
    'Lista rozbieznosci zamknieta (zakres, harmonogram, model umowy, kary/gwarancje)', '—', 30],
  ['WYGRANA', 'Umowa podpisana → handover do realizacji', 100, 0, 0, 'Podpisana umowa', '—', 0],
];

// Normy czasu dla istniejacych kart (STANDARD wygaszany, FAST-TRACK zostaje)
const CZASY_STANDARD = { M1: 21, M2: 30, M3: 45, M4: 45, M5: 45, M6: 60, M7: 60, M8: 60, WYGRANA: 0 };
const CZASY_FAST = { F1: 60, F2: 30, F3: 21, F4: 30, WYGRANA: 0 };

// Biblioteka zadan: [nazwa, oczekiwany_efekt, co_dalej_sukces, co_dalej_porazka, typ]
const ZADANIA = {
  P1: [
    ['Telefon do osoby prowadzacej inwestycje z pytaniem o harmonogram wyboru GW', 'Potwierdzony termin przetargu/zapytania', 'Umow rozmowe o zakresie (P2)', 'Ustal date powrotu do tematu', 'telefon'],
    ['Weryfikacja pozwolenia na budowe w rejestrze (portal e-budownictwo, BIP powiatu)', 'Potwierdzona data i zakres decyzji', 'Przejdz do P2', 'Dopytaj inwestora o status formalny', 'research'],
    ['Mail intro z referencja z tej samej branzy + pytanie o liste oferentow', 'Odpowiedz lub zgoda na rozmowe', 'Zadzwon', 'Dotrzyj przez projektanta', 'mail'],
    ['Kontakt przez pracownie, ktora robila projekt', 'Ciepłe wprowadzenie do inwestora', 'Umow rozmowe', 'Kontakt bezposredni', 'inne'],
  ],
  P2: [
    ['Rozmowa o zakresie na bazie dokumentacji (technologia, powierzchnia, etapowanie)', 'Wypelnione pola scoringu w CRM', 'Umow spotkanie z decydentem (P3)', 'Popros o dostep do dokumentacji', 'telefon'],
    ['Wstepna analiza projektu przez branzystow WPIP (wykonalnosc, ryzyka, optymalizacje)', 'Lista uwag i mozliwych oszczednosci', 'Uzyj uwag jako powodu spotkania', 'Zapytaj o brakujace rysunki', 'research'],
    ['Propozycja optymalizacji kosztowej na bazie gotowego projektu', 'Inwestor widzi wartosc WPIP przed cena', 'Przejdz do P3', 'Podtrzymaj kontakt', 'spotkanie'],
  ],
  P3: [
    ['Spotkanie z decydentem z realizacjami z jego branzy', 'Termin spotkania i wypelniona mapa decyzyjna', 'Przejdz do P4', 'Zaproponuj spotkanie wlasciciel-wlasciciel', 'spotkanie'],
    ['Karta "jak kupuja": kto decyduje, kto doradza, ilu oferentow, kryteria', 'Wypelniona mapa decyzyjna w CRM', 'Przejdz do P4', 'Dopytaj przez konsultanta', 'research'],
    ['Osobna sciezka relacji z inwestorem zastepczym, jesli prowadzi przetarg', 'IZ akceptuje WPIP jako oferenta', 'Przejdz do P4', 'Eskaluj relacje', 'inne'],
  ],
  P4: [
    ['Rozmowa o modelu finansowania + oferta wsparcia (harmonogram platnosci, referencje dla banku)', 'Znane zrodlo i etap finansowania', 'Przejdz do P5', 'Monitoruj etap kredytu', 'spotkanie'],
    ['Weryfikacja formalnego zatwierdzenia inwestycji (uchwala, budzet roczny)', 'Potwierdzenie decyzji "budujemy"', 'Przejdz do P5', 'Ustal termin decyzji', 'research'],
  ],
  P5: [
    ['Doprowadzenie do kompletnosci zapytania (rysunki, przedmiary, warunki)', 'Komplet danych, rejestracja ZOS', 'Wniosek na Komitet', 'Uzupelnij braki', 'inne'],
    ['Ustawienie kryteriow przetargu poza cena (doswiadczenie, harmonogram, gwarancje, BHP)', 'Kryteria uwzglednione w zapytaniu', 'Zloz wniosek na Komitet', 'Renegocjuj kryteria', 'spotkanie'],
    ['Scoring na Komitet + wniosek (materialy 24 h przed)', 'Decyzja BID', 'Przejdz do P6', 'NO-BID → zamknij z powodem', 'inne'],
  ],
  P6: [
    ['Umowienie prezentacji oferty z udzialem decydenta (nie mail!)', 'Spotkanie odbyte, znamy reakcje', 'Przejdz do P7', 'Follow-up watpliwosci', 'spotkanie'],
    ['Pytania o kryteria porownania i pozycje vs konkurencja', 'Wiemy z kim i czym konkurujemy', 'Dopasuj argumentacje', 'Zbierz sygnaly posrednio', 'telefon'],
    ['Follow-up z odpowiedziami na watpliwosci techniczne (branzysci wewnetrzni)', 'Watpliwosci zamkniete', 'Do shortlisty (P7)', 'Eskaluj technicznie', 'mail'],
  ],
  P7: [
    ['Zaproszenie do showroomu Jasin (LEED Platinum, WELL)', 'Wizyta odbyta', 'Przejdz do P8', 'Zaproponuj wizyte na realizacji', 'wizyta'],
    ['Wizyta na realizacji u podobnego klienta + rozmowa z klientem-referencja', 'Dowod spoleczny wlasciciel-wlascicielowi', 'Domknij shortliste', 'Wzmocnij referencje', 'wizyta'],
    ['Przedstawienie zespolu realizacji (KP, KB — stabilna kadra >10 lat)', 'Zaufanie do wykonania', 'Przejdz do P8', 'Buduj relacje', 'spotkanie'],
  ],
  P8: [
    ['Warsztat kontraktowy (harmonogram, etapowanie, kary, gwarancje, regres)', 'Lista rozbieznosci zamknieta', 'Finalizacja → WYGRANA', 'Renegocjuj warunki', 'warsztat'],
    ['Domkniecie tematow banku (dokumenty do uruchomienia kredytu)', 'Brak blokad finansowych', 'Podpisanie umowy', 'Wsparcie finansowania', 'inne'],
    ['Eskalacja zarzadu WPIP do finalnej rundy', 'Decyzja klienta', 'WYGRANA', 'Analiza przegranej', 'spotkanie'],
  ],

  K1: [
    ['Telefon do osoby prowadzacej inwestycje/przetarg', 'Potwierdzone plany + zgoda na kolejna rozmowe', 'Umow rozmowe poglebiajaca (K2)', 'Wroc do researchu', 'telefon'],
    ['Research firmy (KRS, strona, LinkedIn, prasa, rejestry WZ/pozwolen)', 'Nazwisko osoby prowadzacej lub wlasciciela', 'Wyslij mail intro', 'Kontakt przez partnera', 'research'],
    ['Mail intro z dobrym powodem kontaktu (sygnal + 1 wartosc WPIP)', 'Odpowiedz / zgoda na telefon', 'Zadzwon', 'Telefon przez sekretariat', 'mail'],
    ['Spotkanie na targach / wydarzeniu branzowym', 'Rozmowa bezposrednia', 'Potwierdz plany (K1)', 'Follow-up mailowy', 'spotkanie'],
  ],
  K2: [
    ['Rozmowa poglebiajaca wg checklisty (dzialka, MPZP/WZ, powierzchnia, technologia, budzet, termin)', 'Wypelnione pola scoringu w CRM', 'Zaproponuj prace nad koncepcja (K3)', 'Doprecyzuj brakujace dane', 'telefon'],
    ['Weryfikacja dzialki i statusu formalnego (geoportal, rejestr decyzji)', 'Potwierdzenie lub zaprzeczenie deklaracji', 'Przejdz do K3', 'Oznacz ryzyko formalne', 'research'],
    ['Mini-doradztwo: checklista "co musi byc gotowe, zanim GW policzy rzetelnie"', 'Klient dzieli sie dokumentami', 'Zbierz dokumenty', 'Podtrzymaj kontakt', 'mail'],
  ],
  K3: [
    ['Warsztat koncepcyjny z inwestorem i pracownia (uklad, technologia, etapowanie)', 'Zaakceptowany program funkcjonalny', 'Ustal model realizacji (K4)', 'Doprecyzuj potrzeby produkcyjne', 'warsztat'],
    ['Analiza chlonnosci dzialki i wariantow ukladu', 'Warianty z kosztami zgrubnymi', 'Wybor wariantu', 'Zweryfikuj ograniczenia formalne', 'research'],
    ['Wstepny budzet inwestycji na bazie koncepcji (widelki, nie oferta)', 'Inwestor zna rzad wielkosci przed projektowaniem', 'Przejdz do K4', 'Urealnij zakres', 'inne'],
    ['Wlaczenie WPIP Green Energy do koncepcji (PV, pompy, magazyn, PVaaS)', 'Rozszerzony zakres i argument kosztowy', 'Dolacz OZE do dalszych rozmow', 'Zostaw jako opcje', 'inne'],
  ],
  K4: [
    ['Rozmowa o trybie: osobny projekt czy zaprojektuj-i-buduj z WPIP', 'Decyzja o modelu realizacji', 'Przejdz do K5', 'Wroc z argumentami za D&B', 'spotkanie'],
    ['Rekomendacja pracowni z portfela WPIP (jesli inwestor wybiera osobno)', 'WPIP obecny przy powstawaniu projektu', 'Utrzymaj kontakt z pracownia', 'Monitoruj wybor projektanta', 'inne'],
    ['Warsztat "co projekt musi zawierac, zeby wycena byla porownywalna"', 'Projekt powstaje z mysla o realnym budzecie', 'Przejdz do K5', 'Podtrzymaj kontakt', 'warsztat'],
  ],
  K5: [
    ['Zaproszenie wlasciciela na spotkanie z realizacjami z jego branzy', 'Termin spotkania', 'Wypelnij mape decyzyjna', 'Zaproponuj spotkanie wlasciciel-wlasciciel', 'spotkanie'],
    ['Karta "jak kupuja": kto decyduje, kto doradza, ilu oferentow, kryteria', 'Wypelniona mapa decyzyjna w CRM', 'Przejdz do K6', 'Dopytaj przez konsultanta', 'research'],
    ['Osobna sciezka relacji z inwestorem zastepczym (jesli jest)', 'IZ zna i akceptuje WPIP', 'Przejdz do K6', 'Eskaluj relacje', 'inne'],
  ],
  K6: [
    ['Rozmowa o modelu finansowania + oferta pomocy (dane do wniosku, referencje dla banku)', 'Znane zrodlo i etap finansowania', 'Potwierdz decyzje inwestycyjna', 'Monitoruj etap kredytu', 'spotkanie'],
    ['Weryfikacja formalnego zatwierdzenia inwestycji (uchwala, budzet roczny)', 'Potwierdzenie decyzji "budujemy"', 'Przejdz do K7', 'Ustal termin decyzji', 'research'],
    ['Propozycja PVaaS / finansowania OZE bez CAPEX jako odciazenie budzetu', 'Usunieta bariera budzetowa', 'Przejdz do K7', 'Zostaw jako opcje', 'inne'],
  ],
  K7: [
    ['Monitoring postepu wniosku o pozwolenie (kontakt z pracownia / urzedem)', 'Znany realny termin decyzji', 'Przygotuj sie do zapytania (K8)', 'Zaktualizuj prognoze terminu', 'research'],
    ['Wsparcie w usuwaniu brakow formalnych (doswiadczenie WPIP z urzedami)', 'Skrocony czas oczekiwania', 'Przejdz do K8', 'Ustal nowy termin', 'inne'],
    ['Utrzymanie kontaktu w czasie oczekiwania (rytm co 3-4 tygodnie)', 'Temat nie zastyga, WPIP zostaje w grze', 'Wznow rozmowe o zapytaniu', 'Ustal date kolejnego kontaktu', 'telefon'],
  ],
  K8: [
    ['Doprowadzenie do kompletnosci briefu (PFU, mapa, warunki)', 'Komplet danych, rejestracja ZOS', 'Wniosek na Komitet', 'Uzupelnij braki', 'inne'],
    ['Ustawienie kryteriow przetargu poza cena', 'Kryteria uwzglednione w zapytaniu', 'Zloz wniosek na Komitet', 'Renegocjuj kryteria', 'spotkanie'],
    ['Scoring na Komitet + wniosek (materialy 24 h przed)', 'Decyzja BID', 'Przejdz do K9', 'NO-BID → zamknij z powodem', 'inne'],
  ],
  K9: [
    ['Umowienie prezentacji oferty z udzialem decydenta (nie mail!)', 'Spotkanie odbyte, znamy reakcje', 'Przejdz do K10', 'Follow-up watpliwosci', 'spotkanie'],
    ['Pytania o kryteria porownania i pozycje vs konkurencja', 'Wiemy z kim i czym konkurujemy', 'Dopasuj argumentacje', 'Zbierz sygnaly posrednio', 'telefon'],
    ['Follow-up z odpowiedziami na watpliwosci techniczne', 'Watpliwosci zamkniete', 'Do shortlisty (K10)', 'Eskaluj technicznie', 'mail'],
  ],
  K10: [
    ['Zaproszenie do showroomu Jasin (LEED Platinum, WELL)', 'Wizyta odbyta', 'Przejdz do K11', 'Zaproponuj wizyte na realizacji', 'wizyta'],
    ['Wizyta na realizacji u podobnego klienta', 'Dowod spoleczny wlasciciel-wlascicielowi', 'Domknij shortliste', 'Wzmocnij referencje', 'wizyta'],
    ['Przedstawienie zespolu realizacji', 'Zaufanie do wykonania', 'Przejdz do K11', 'Buduj relacje', 'spotkanie'],
  ],
  K11: [
    ['Warsztat kontraktowy (harmonogram, etapowanie, kary, gwarancje, regres)', 'Lista rozbieznosci zamknieta', 'Finalizacja → WYGRANA', 'Renegocjuj warunki', 'warsztat'],
    ['Domkniecie tematow banku', 'Brak blokad finansowych', 'Podpisanie umowy', 'Wsparcie finansowania', 'inne'],
    ['Eskalacja zarzadu WPIP do finalnej rundy', 'Decyzja klienta', 'WYGRANA', 'Analiza przegranej', 'spotkanie'],
  ],
};

// Kryteria kamienia — twarda bramka i zarazem miara "ile brakuje" w karcie PDCA
const KRYTERIA = {
  P1: ['Rozmowa z osobą prowadzącą temat odbyta', 'Pozwolenie na budowę potwierdzone (numer/data)', 'Znany harmonogram wyboru wykonawcy'],
  P2: ['Zakres potwierdzony na podstawie dokumentacji', 'Budżet potwierdzony widełkowo', 'Znany oczekiwany termin rozpoczęcia'],
  P3: ['Spotkanie z decydentem odbyte', 'Mapa decyzyjna wypełniona', 'Znany tryb wyboru GW i liczba oferentów'],
  P4: ['Znane źródło finansowania i jego etap', 'Decyzja „budujemy" formalnie potwierdzona'],
  P5: ['Komplet dokumentacji do wyceny', 'ZOS zarejestrowany', 'Decyzja BID Komitetu Ofertowego'],
  P6: ['Oferta zaprezentowana na spotkaniu z decydentem', 'Znane kryteria porównania i pozycja vs konkurencja'],
  P7: ['Shortlista potwierdzona', 'Wizyta referencyjna odbyta'],
  P8: ['Lista rozbieżności kontraktowych zamknięta', 'Brak blokad po stronie finansowania'],

  K1: ['Rozmowa z osobą prowadzącą temat odbyta', 'Plany budowy potwierdzone (nie plotka)', 'Zgoda na kolejny kontakt'],
  K2: ['Znany status działki (MPZP/WZ)', 'Budżet potwierdzony widełkowo', 'Znany horyzont czasowy', 'Znana szacowana powierzchnia'],
  K3: ['Program funkcjonalny zaakceptowany przez inwestora', 'Wariant układu wybrany', 'Budżet zgrubny przedstawiony'],
  K4: ['Tryb realizacji rozstrzygnięty (osobny projekt vs Design-Build)', 'Znana pracownia projektowa lub decyzja o D&B z WPIP'],
  K5: ['Spotkanie z decydentem odbyte', 'Mapa decyzyjna wypełniona', 'Znany model wyboru GW'],
  K6: ['Znane źródło finansowania i jego etap', 'Decyzja „budujemy" formalnie potwierdzona'],
  K7: ['Wniosek o pozwolenie złożony lub decyzja uzyskana', 'Znany realny termin uprawomocnienia'],
  K8: ['Komplet danych do wyceny (brief / PFU)', 'ZOS zarejestrowany', 'Decyzja BID Komitetu Ofertowego'],
  K9: ['Oferta zaprezentowana na spotkaniu z decydentem', 'Znane kryteria porównania i pozycja vs konkurencja'],
  K10: ['Shortlista potwierdzona', 'Wizyta referencyjna odbyta'],
  K11: ['Lista rozbieżności kontraktowych zamknięta', 'Brak blokad po stronie finansowania'],
};

// Powody zamkniecia per kamien: [kod, nazwa, recyklingowalny, offset_mies]
const POWODY = [
  ['P1', 'Wykonawca już wybrany / przetarg rozstrzygnięty', 0, 0],
  ['P1', 'Nie da się dotrzeć do nikogo (po X próbach)', 1, 3],
  ['P1', 'Projekt poniżej progu (<10 mln)', 0, 0],
  ['P2', 'Budżet nierealny vs zakres z dokumentacji', 0, 0],
  ['P2', 'Start przesunięty o rok+', 1, 12],
  ['P3', 'Brak dostępu do decydenta (gatekeeper blokuje)', 1, 3],
  ['P3', 'Decydent ma faworyta / GW „rodzinnego"', 0, 0],
  ['P4', 'Brak finansowania / odmowa banku', 1, 6],
  ['P4', 'Zmiana priorytetów właściciela', 1, 6],
  ['P5', 'NO-BID (scoring)', 0, 0],
  ['P5', 'Przetarg ustawiony pod konkurenta', 0, 0],
  ['P6', 'Odpadliśmy cenowo', 0, 0],
  ['P6', 'Odpadliśmy zakresowo', 0, 0],
  ['P7', 'Poza shortlistą', 0, 0],
  ['P8', 'Przegrana w finale (cena/warunki)', 0, 0],
  ['P8', 'Klient odroczył podpisanie', 1, 3],

  ['K1', 'Brak planów (fałszywy sygnał)', 0, 0],
  ['K1', 'Plany >24 mc', 1, 6],
  ['K1', 'Nie da się dotrzeć do nikogo', 1, 3],
  ['K2', 'Działka bez perspektywy formalnej >12 mc', 1, 6],
  ['K2', 'Budżet nierealny vs zakres', 0, 0],
  ['K3', 'Inwestor zrezygnował z rozbudowy', 0, 0],
  ['K3', 'Koncepcja przejęta przez pracownię bez udziału WPIP', 1, 6],
  ['K4', 'Wybrano tryb wykluczający WPIP (projekt osobno + przetarg zamknięty)', 1, 12],
  ['K5', 'Brak dostępu do decydenta', 1, 3],
  ['K5', 'Temat przejęty przez wrogiego IZ', 0, 0],
  ['K6', 'Brak finansowania / odmowa banku', 1, 6],
  ['K6', 'Przesunięcie decyzji o rok+', 1, 12],
  ['K7', 'Odmowa pozwolenia / protest', 1, 12],
  ['K7', 'Procedura przedłuża się bez końca', 1, 6],
  ['K8', 'NO-BID (scoring)', 0, 0],
  ['K8', 'Przetarg ustawiony pod konkurenta', 0, 0],
  ['K9', 'Odpadliśmy cenowo', 0, 0],
  ['K9', 'Klient zamroził przetarg', 1, 6],
  ['K10', 'Poza shortlistą', 0, 0],
  ['K11', 'Przegrana w finale', 0, 0],
];

// Etap projektu inwestora (komponent D scoringu) → sciezka procesu.
// Brak danych traktujemy jak brak projektu — bezpieczniej przeszacowac czas
// niz obiecac szesc miesiecy tam, gdzie nie ma jeszcze rysunku.
export const ETAP_NA_SCIEZKE = {
  'Wybór generalnego wykonawcy': 'PROJEKT_PNB',
  'Projektowanie zakończone': 'PROJEKT_PNB',
  'Budowa trwa': 'PROJEKT_PNB',
  'Projektowanie': 'KONCEPCJA',
  'Wybór głównego projektanta': 'KONCEPCJA',
  'Wizja': 'KONCEPCJA',
  'Zapowiedź inwestycji': 'KONCEPCJA',
};

// Etykiety etapu przychodza z kilku zrodel (slownik scoringu, import KI, wpis reczny)
// i roznia sie wielkoscia liter — "Wybór Generalnego Wykonawcy" vs "Wybór generalnego
// wykonawcy". Porownujemy po znormalizowanym kluczu, zeby literowka nie wysylala
// tematu na dwa razy dluzsza sciezke.
const norm = (s) => String(s || '').trim().toLowerCase();
const ETAP_ZNORMALIZOWANY = Object.fromEntries(
  Object.entries(ETAP_NA_SCIEZKE).map(([k, v]) => [norm(k), v]));

/** Kod sciezki dla etapu projektu; brak danych → sciezka dluzsza (ostrozniejsza). */
export function sciezkaDlaEtapu(etapProjektu) {
  return ETAP_ZNORMALIZOWANY[norm(etapProjektu)] || 'KONCEPCJA';
}

/** Karta procesu dla danego etapu projektu; klient powracajacy ma pierwszenstwo. */
export function kartaDlaEtapu(db, etapProjektu, klientPowracajacy = false) {
  const kod = klientPowracajacy ? 'FAST_TRACK' : sciezkaDlaEtapu(etapProjektu);
  return db.prepare('SELECT * FROM karty_ratingu WHERE kod = ?').get(kod)
    || db.prepare(`SELECT * FROM karty_ratingu WHERE aktywna = 1 ORDER BY id LIMIT 1`).get();
}

// Mapowanie kamieni STANDARD na kamienie nowych sciezek przy migracji tematow
const MAPA_MIGRACJI = {
  PROJEKT_PNB: { M1: 'P1', M2: 'P2', M3: 'P3', M4: 'P4', M5: 'P5', M6: 'P6', M7: 'P7', M8: 'P8', WYGRANA: 'WYGRANA' },
  KONCEPCJA: { M1: 'K1', M2: 'K2', M3: 'K5', M4: 'K6', M5: 'K8', M6: 'K9', M7: 'K10', M8: 'K11', WYGRANA: 'WYGRANA' },
};

export function seedPipelineV3(db) {
  if (db.prepare(`SELECT wartosc FROM konfiguracja WHERE klucz = 'pipeline_v3_seed'`).get()) return;

  // ── 1. Normy czasu dla istniejacych kart ───────────────────────────────────
  const updCzas = db.prepare(`UPDATE kamienie_karty SET czas_typowy_dni = ?
    WHERE kod = ? AND karta_id = (SELECT id FROM karty_ratingu WHERE kod = ?)`);
  for (const [kod, dni] of Object.entries(CZASY_STANDARD)) updCzas.run(dni, kod, 'STANDARD');
  for (const [kod, dni] of Object.entries(CZASY_FAST)) updCzas.run(dni, kod, 'FAST_TRACK');

  // ── 2. Nowe sciezki ────────────────────────────────────────────────────────
  const insKarta = db.prepare('INSERT INTO karty_ratingu (nazwa, opis, persona, kod) VALUES (?,?,?,?)');
  const insKamien = db.prepare(`INSERT INTO kamienie_karty
    (karta_id, kolejnosc, nazwa, kod, prawd_start, prawd_min, prawd_max, prog_zastygniecia_dni,
     elastyczna_kolejnosc, definicja_spelnienia, wymiary_scoringu, czas_typowy_dni)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insZad = db.prepare(`INSERT INTO task_szablony
    (kamien_id, nazwa, oczekiwany_efekt, co_dalej_sukces, co_dalej_porazka, typ, kolejnosc) VALUES (?,?,?,?,?,?,?)`);
  const insKryt = db.prepare('INSERT INTO kamien_kryteria (kamien_id, tekst, obowiazkowe, kolejnosc) VALUES (?,?,1,?)');
  const insPow = db.prepare('INSERT INTO powody_zamkniecia (kamien_kod, nazwa, czy_recyklingowalny, offset_powrotu_mies) VALUES (?,?,?,?)');

  function zbuduj(nazwa, opis, persona, kod, kamienie) {
    const istnieje = db.prepare('SELECT id FROM karty_ratingu WHERE kod = ?').get(kod);
    if (istnieje) return istnieje.id;
    const kartaId = Number(insKarta.run(nazwa, opis, persona, kod).lastInsertRowid);
    kamienie.forEach((k, i) => {
      const [kodK, nazwaK, prawd, prog, elast, dowod, wymiary, czas] = k;
      const prawdMin = i === 0 ? 0 : kamienie[i - 1][2] + 1;
      const kamienId = Number(insKamien.run(kartaId, i + 1, nazwaK, kodK, prawd, prawdMin, prawd,
        prog || null, elast, dowod, wymiary, czas).lastInsertRowid);
      (ZADANIA[kodK] || []).forEach((z, j) => insZad.run(kamienId, z[0], z[1], z[2], z[3], z[4], j));
      (KRYTERIA[kodK] || ['Umowa podpisana']).forEach((t, j) => insKryt.run(kamienId, t, j));
    });
    return kartaId;
  }

  const idProjekt = zbuduj(
    'PROJEKT + POZWOLENIE — inwestor gotowy do wyboru GW',
    'Inwestor ma projekt i pozwolenie na budowę. Proces startuje blisko przetargu, cykl ~6 miesięcy.',
    'Inwestor z gotową dokumentacją', 'PROJEKT_PNB', PROJEKT_PNB);

  const idKoncepcja = zbuduj(
    'KONCEPCJA — inwestor bez projektu',
    'Brak projektu; pracujemy nad koncepcją, projektem i pozwoleniem razem z inwestorem. Cykl 12–18 miesięcy.',
    'Inwestor na etapie koncepcji', 'KONCEPCJA', KONCEPCJA);

  for (const p of POWODY) {
    const jest = db.prepare('SELECT 1 FROM powody_zamkniecia WHERE kamien_kod = ? AND nazwa = ?').get(p[0], p[1]);
    if (!jest) insPow.run(p[0], p[1], p[2], p[3]);
  }

  // ── 3. Migracja tematow z wygaszanego STANDARD ─────────────────────────────
  const standard = db.prepare(`SELECT id FROM karty_ratingu WHERE kod = 'STANDARD'`).get();
  let przeniesione = 0;
  if (standard) {
    const kamienieStd = db.prepare('SELECT id, kod FROM kamienie_karty WHERE karta_id = ?').all(standard.id);
    const kodStd = Object.fromEntries(kamienieStd.map(k => [k.id, k.kod]));

    const kamienieNowe = {};
    for (const [kod, id] of [['PROJEKT_PNB', idProjekt], ['KONCEPCJA', idKoncepcja]]) {
      kamienieNowe[kod] = Object.fromEntries(
        db.prepare('SELECT id, kod FROM kamienie_karty WHERE karta_id = ?').all(id).map(k => [k.kod, k.id]));
    }

    const tematy = db.prepare(`SELECT t.*, i.etap_projektu, k.klient_powracajacy
      FROM tematy t
      LEFT JOIN inwestycje i ON i.id = t.inwestycja_id
      LEFT JOIN klienci k ON k.id = t.klient_id
      WHERE t.karta_id = ?`).all(standard.id);

    for (const t of tematy) {
      const docelowa = sciezkaDlaEtapu(t.etap_projektu);
      const nowaKartaId = docelowa === 'PROJEKT_PNB' ? idProjekt : idKoncepcja;
      const mapa = MAPA_MIGRACJI[docelowa];
      const naNowy = (staryId) => kamienieNowe[docelowa][mapa[kodStd[staryId]] || ''] || null;

      // Potwierdzenia, wejscia i dzialania przenosza sie na odpowiedniki kamieni
      for (const tabela of ['potwierdzenia_kamieni', 'milestone_wejscia', 'dzialania']) {
        for (const w of db.prepare(`SELECT id, kamien_id FROM ${tabela} WHERE temat_id = ? AND kamien_id IS NOT NULL`).all(t.id)) {
          const nowy = naNowy(w.kamien_id);
          if (nowy) db.prepare(`UPDATE ${tabela} SET kamien_id = ? WHERE id = ?`).run(nowy, w.id);
        }
      }
      // Szablony zadan naleza do starej karty — dowiazujemy po nazwie albo zrywamy
      for (const d of db.prepare('SELECT id, kamien_id, cel FROM dzialania WHERE temat_id = ? AND template_id IS NOT NULL').all(t.id)) {
        const dopasowany = db.prepare('SELECT id FROM task_szablony WHERE kamien_id = ? AND nazwa = ?').get(d.kamien_id, d.cel);
        db.prepare('UPDATE dzialania SET template_id = ? WHERE id = ?').run(dopasowany?.id ?? null, d.id);
      }

      // Odhaczone kryteria: stary kamien → nowy kamien → kryterium o tej samej tresci.
      // Dotycza takze kamieni juz zamknietych, wiec mapujemy przez kamien kryterium,
      // a nie przez biezacy kamien tematu.
      for (const o of db.prepare(`SELECT o.id, kk.kamien_id AS stary_kamien, kk.tekst
        FROM kryteria_odhaczenia o JOIN kamien_kryteria kk ON kk.id = o.kryterium_id
        WHERE o.temat_id = ?`).all(t.id)) {
        const nowyKamienKryt = naNowy(o.stary_kamien);
        const nowe = nowyKamienKryt
          ? db.prepare('SELECT id FROM kamien_kryteria WHERE kamien_id = ? AND tekst = ?').get(nowyKamienKryt, o.tekst)
          : null;
        // Bez odpowiednika kasujemy odhaczenie — inaczej wskazywaloby na kryterium
        // wygaszonej karty i zafalszowalo licznik "ile brakuje".
        if (nowe) db.prepare('UPDATE kryteria_odhaczenia SET kryterium_id = ? WHERE id = ?').run(nowe.id, o.id);
        else db.prepare('DELETE FROM kryteria_odhaczenia WHERE id = ?').run(o.id);
      }

      const nowyKamien = naNowy(t.kamien_id);
      db.prepare('UPDATE tematy SET karta_id = ?, kamien_id = COALESCE(?, kamien_id) WHERE id = ?')
        .run(nowaKartaId, nowyKamien, t.id);
      db.prepare(`INSERT INTO historia_tematu (temat_id, typ_zmiany, wartosc_przed, wartosc_po, opis)
        VALUES (?,?,?,?,?)`).run(t.id, 'zmiana ścieżki', 'STANDARD', docelowa,
          `Rozdzielenie procesu wg etapu projektu inwestora (${t.etap_projektu || 'etap nieznany'})`);
      przeniesione++;
    }

    if (!db.prepare('SELECT COUNT(*) c FROM tematy WHERE karta_id = ?').get(standard.id).c) {
      db.prepare('UPDATE karty_ratingu SET aktywna = 0 WHERE id = ?').run(standard.id);
    }
  }

  db.prepare(`INSERT INTO konfiguracja (klucz, wartosc) VALUES ('pipeline_v3_seed', ?)`)
    .run(new Date().toISOString());
  console.log(`Pipeline v3: ścieżki PROJEKT_PNB i KONCEPCJA gotowe, przeniesionych tematów: ${przeniesione}`);
}
