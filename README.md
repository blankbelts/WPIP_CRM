# WPIP CRM — New Business (Faza 1)

Aplikacja webowa pokrywająca ścieżkę **od prospectingu do wygrania leada**, zbudowana na bazie
kompendium `WPIP_CRM_kompendium_docelowa_aplikacja.md` (wersja 1.0, 07.07.2026).

## Uruchomienie

```
cd app
npm install   # tylko raz
npm start
```

Aplikacja: **http://localhost:3400**

## Logowanie

Aplikacja wymaga zalogowania (sesja w cookie HttpOnly, hasło hashowane scrypt).
Konto tworzy się automatycznie przy pierwszym starcie z pustą bazą:

- lokalnie: login `krystian`, hasło `wpip-crm-2026` — **zmień w Ustawieniach → Konto**,
- na serwerze: ustaw zmienne środowiskowe `CRM_LOGIN`, `CRM_HASLO` (i opcjonalnie `CRM_IMIE`)
  **przed pierwszym uruchomieniem** — konto seeduje się tylko raz, przy pustej tabeli użytkowników.

## Wdrożenie na Railway

1. Wypchnij ten katalog (`app/`) jako repozytorium na GitHub (prywatne).
2. W Railway: **New Project → Deploy from GitHub repo** — Nixpacks wykryje Node (wymagany Node ≥ 24,
   zadeklarowany w `engines`) i uruchomi `npm start`.
3. **Wolumen (krytyczne!):** w ustawieniach serwisu dodaj Volume zamontowany w `/data`
   i ustaw zmienną `DATA_DIR=/data`. Bez tego baza SQLite znika przy każdym deployu.
4. Zmienne środowiskowe: `DATA_DIR=/data`, `CRM_LOGIN=...`, `CRM_HASLO=...` (silne hasło).
5. Railway nada domenę https — cookie sesji automatycznie dostaje flagę `Secure` za proxy.

Dane trzymane są w pliku `app/wpip-crm.sqlite` (SQLite wbudowane w Node 24 — zero dodatkowych
instalacji). Usunięcie tego pliku resetuje bazę do stanu startowego (karta ratingu + słowniki
+ opcje scoringu z kompendium). W bazie jest kilka rekordów demo (Bispol, Fabryka mebli, CTP)
pokazujących pełny przepływ — można je zostawić lub skasować plik bazy przed realną pracą.

## Pokrycie procesów z kompendium

| Moduł | Proces z kompendium / dokumentu scoringowego |
|---|---|
| **Import leadów** | Import XLSX do wskazanej **grupy leadów** (= jedna baza, jak pliki v1–v6): surowy eksport KI (40 kolumn, klucz `Id`) oraz arkusze TOP po researchu (SCORE, Priorytet, Klasyfikacja, Branża, Status researchu — przenoszone na leada). Heurystyka klasyfikacji (odpowiednik preprocesu Python) proponuje wybory komponentów; punkty nalicza wersja scoringu grupy. Nakład baz nie duplikuje: istniejący lead dostaje wystąpienie + aktualizację etapu/kosztu z auto-przeliczeniem. Logika: `import-ki.js` |
| **Scoring leadów (wersje + grupy)** | Wersja scoringu = arkusz Parametry: komponenty A / B / C / D / E1 / E2 / E3 / F z opcjami i punktami, progi priorytetów (start 85/70/55), reguły dyskwalifikacji X (CTP, in-house GW, publiczne/wojskowe). Wersje robocze edytowalne; wersja użyta do przeliczenia zostaje **zamrożona** — zmiany przez duplikat. „Przelicz grupę" przelicza wszystkie leady i loguje zmiany priorytetów. Logika: `scoring.js` |
| **Leady / Prospecting** | Lead opisany **wyborami komponentów** (edytowalne — reklasyfikacja jak Futureal auto-przelicza scoring), status researchu SZARY/ZIELONY/ŻÓŁTY (obowiązkowa notatka ryzyka)/CZERWONY, **ścieżka pozyskania tematu**: Lead surowy → Research → Lead wzbogacony → Pierwszy kontakt → Kontakt odpowiedział → Rozmowa poznawcza → Zakwalifikowany → Komitet. Bramka: lead A nie wyjdzie poza Research bez koloru ZIELONY/ŻÓŁTY; CZERWONY blokuje wszystkich. Wyjścia boczne: Odpuszczony (powód), Uśpiony (nurture). Widok kanban + tabela, filtr grup, historia leada (audyt konwersji prospect→lead→temat) |
| **Komitet Ofertowy** | Bramka bid / no bid / defer z obowiązkowym powodem (słownik); decyzja BID tworzy temat z identyfikatorem `Inwestor_TypInwestycji` |
| **Pipeline** | Karta ratingu jako odrębny konfigurowalny obiekt; 6 kamieni (Lead 5% → Umowa 100%); awans kamienia = decyzja handlowca; działania outcome-driven z deltami % w obrębie kamienia; korekta ręczna tylko w zakresie kamienia, oznaczana w audycie; cofnięcie kamienia z powodem; zamknięcie win/loss z obowiązkowym kodem przyczyny; pełna historia zmian |
| **Klienci i osoby** | Kartoteka z flagą klient powracający, potencjał OZE (GW-first), dyskwalifikacja strategiczna, role w decyzji (DMU) |
| **Działania** | Cel = rezultat od klienta (nie czynność); widok tygodnia + pełna historia (track record) |
| **Pulpit** | Wartość pipeline (nominalna i ważona), win rate vs baseline 23%, leady wg priorytetów, przychód po kwartałach (auto-rozkład z terminu realizacji i czasu trwania), zadania tygodnia |
| **Ustawienia** | Karta ratingu, progi scoringu i słowniki edytowalne w UI bez programisty (warunek iteracji na wagach) |

## Kluczowe zasady zaimplementowane

- **Scoring liczony z wyborów, nie zapisany na sztywno** — lead przechowuje wybory {komponent: etykieta}; punkty i priorytet wynikają z wersji scoringu, więc przeliczenie inną wersją to lookup, a każdy score jest odtwarzalny (lead pamięta wersję).
- **Dwie oddzielne osie prawdopodobieństwa**: % kwalifikacji (leady) ≠ % wygranej (pipeline).
- **Awans kamienia = decyzja handlowca**, nie automat; delty w obrębie kamienia = automat z wyników działań.
- **Scoring jest wejściem do decyzji Komitetu, nie decyzją** — Komitet może odrzucić lead A/120.
- **Identyfikator tematu na całe życie** (`Inwestor_TypInwestycji`) — klucz do przyszłych integracji z rejestrami.
- **Idempotencja importów** — inwestycje z `id_zrodlowe` nie duplikują się przy ponownym imporcie.
- **CRM niezależny od źródła danych** — baza sygnałów (KI) to jedna z opcji słownika źródeł.

## Architektura

- `server.js` — Express, serwuje API + frontend
- `db.js` — schemat SQLite + seed (karta ratingu, słowniki, opcje scoringu)
- `api.js` — cała logika biznesowa (scoring, mechanika prawdopodobieństwa, bramka Komitetu)
- `public/` — frontend SPA bez kroku budowania (ES modules), widoki w `public/js/views/`

## Poza zakresem Fazy 1 (zgodnie z roadmapą)

Import z Excela (K1), rejestry ofertowe (K3), marketing/tracking (K5), dashboardy trzech warstw
KPI (K6), integracja ERP (K7), auto-import sygnałów, buyer persony formalne, mobile (Q1 2027).
