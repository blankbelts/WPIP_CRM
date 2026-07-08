// Import inwestycji z bazy sygnalow (KI) - parsowanie XLSX + heurystyki propozycji wyborow A-F
// Heurystyka odpowiada preprocesowi Python z prac scoringowych: wzorce tekstowe na polach
// Inwestor / Nazwa / Podsektor / Etap. Wynik to PROPOZYCJE wyborow - jawne i edytowalne na leadzie.
// Obslugiwane formaty:
//  - surowy eksport KI ("Wszystkie inwestycje"): Id, Nazwa, Podsektor, Wojewodztwo, Etap, Koszt (mln)...
//  - arkusze TOP po researchu: #, SCORE, Priorytet, Inwestor, Klasyfikacja, Branza, Status researchu
import * as XLSX from 'xlsx';
import { db } from './db.js';

const normalizuj = (s) => String(s ?? '').trim();

function znajdzKolumne(naglowki, ...kandydaci) {
  for (const k of kandydaci) {
    const idx = naglowki.findIndex(n => normalizuj(n).toLowerCase() === k.toLowerCase());
    if (idx >= 0) return idx;
  }
  for (const k of kandydaci) {
    const idx = naglowki.findIndex(n => normalizuj(n).toLowerCase().includes(k.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ---------- Heurystyki propozycji wyborow (etykiety musza odpowiadac opcjom wersji v6) ----------

function wybierzA(podsektor) {
  const p = normalizuj(podsektor).toLowerCase();
  if (p.includes('produkc')) return 'Zakłady produkcyjne';
  if (p.includes('magazyn') || p.includes('logisty')) return 'Magazyny / centra logistyczne';
  if (p.includes('hotel') || p.includes('pensjonat')) return 'Hotele / pensjonaty';
  if (p.includes('biur')) return 'Biurowce';
  if (p.includes('handlow') || p.includes('usługow') || p.includes('uslugow')) return 'Handel';
  return null;
}

function wybierzB(koszt) {
  const k = Number(String(koszt).replace(',', '.'));
  if (!k || isNaN(k)) return 'Brak danych o wartości';
  if (k >= 30 && k <= 60) return '30-60 mln PLN (sweet spot)';
  if (k >= 20 && k < 30) return '20-30 mln PLN';
  if (k > 60 && k <= 80) return '60-80 mln PLN';
  if (k >= 15 && k < 20) return '15-20 mln PLN';
  if (k > 80 && k <= 100) return '80-100 mln PLN';
  return 'Poza przedziałami (<15 lub >100)';
}

const DEWELOPERZY = /panattoni|7r\b|mlp|segro|prologis|glp|logicor|dl invest|peakside|ideal idea|karnal|futureal|hillwood|p3\b|garbe/i;
const PUBLICZNE = /zarząd infrastruktury|zarzad infrastruktury|ministerstw|urząd|urzad|gmin[ay]|miast[oa]\b|powiat\w* |marszałkowsk|marszalkowsk|wojewódzk|wojewodzk|komenda|straż|straz|policj|wojskow|uniwersytet|politechnik|szpital|samorzad|samorząd|skarbu państwa|zus\b|nfz\b|sąd|sad okręgowy|agencja rozwoju miasta/i;
const KORPORACJE = /gmbh|ag\b|s\.?a\.?r\.?l|b\.?v\.?|valeo|mubea|man truck|takenaka|bosch|siemens|toyota|volkswagen|mercedes|stellantis|lg\b|samsung|amazon|zalando|nestle|unilever|procter|mondelez|danone|coca|pepsi|heineken|carlsberg|ikea|leroy|castorama|lidl|kaufland|aldi|dhl|db schenker|raben|kuehne|fedex|ups\b|schnee|grigeo|stadler|mars\b|thule/i;
const WLASNY_GW = /pekabex|komart|budimex|mirbud|strabag|skanska|goldbeck|atlas ward|commercecon|comm-?build|p\.?a\.? nova|trasko|dekpol|erbud|unibep|panbud/i;

function wybierzC({ klasyfikacja, czyPrywatna, inwestor }) {
  // Klasyfikacja z researchu (arkusze TOP) ma pierwszenstwo nad heurystyka
  if (klasyfikacja) {
    const k = klasyfikacja.toLowerCase();
    if (/ctp/.test(k)) return { etykieta: 'CTP' };
    if (/własny|wlasny|in-?house/.test(k)) return { etykieta: 'Firma z własnym GW w grupie' };
    if (/publiczn|wojskow/.test(k)) return { etykieta: 'Publiczny / wojskowy' };
    if (/polska firma|mid-market/.test(k)) return { etykieta: 'Polska firma operacyjna / mid-market' };
    if (/sse|park|strefa.*operator/.test(k)) return { etykieta: 'SSE z operatorem' };
    if (/korporacja|zagranicz/.test(k)) return { etykieta: 'Korporacja zagraniczna' };
    if (/sama strefa/.test(k)) return { etykieta: 'Sama strefa (bez operatora)' };
    if (/deweloper/.test(k)) return { etykieta: 'Deweloper magazynowy' };
    return { etykieta: 'Polska firma operacyjna / mid-market', weryfikacja: true };
  }
  const inw = normalizuj(inwestor);
  if (/\bctp\b/i.test(inw)) return { etykieta: 'CTP' };
  if (WLASNY_GW.test(inw)) return { etykieta: 'Firma z własnym GW w grupie', weryfikacja: true };
  if (normalizuj(czyPrywatna).toLowerCase() === 'publiczna' || PUBLICZNE.test(inw)) {
    return { etykieta: 'Publiczny / wojskowy' };
  }
  if (DEWELOPERZY.test(inw)) return { etykieta: 'Deweloper magazynowy', weryfikacja: true };
  if (/specjaln\w* strefa|invest-park|\bsse\b/i.test(inw)) return { etykieta: 'SSE z operatorem', weryfikacja: true };
  if (KORPORACJE.test(inw)) return { etykieta: 'Korporacja zagraniczna', weryfikacja: true };
  // Kategoria domyslna i pozytywna (por. sekcja 5.1 podsumowania scoringu)
  return { etykieta: 'Polska firma operacyjna / mid-market', weryfikacja: true };
}

function wybierzD(etap) {
  const e = normalizuj(etap).toLowerCase();
  if (e.includes('wybór generalnego') || e.includes('wybor generalnego') || e.includes('wybór gw')) return 'Wybór generalnego wykonawcy';
  if (e.includes('projektowanie zakończone') || e.includes('projektowanie zakonczone')) return 'Projektowanie zakończone';
  if (e.includes('projektanta')) return 'Wybór głównego projektanta';
  if (e.includes('projektowanie')) return 'Projektowanie';
  if (e.includes('wizja')) return 'Wizja';
  if (e.includes('zapowiedź') || e.includes('zapowiedz')) return 'Zapowiedź inwestycji';
  if (e.includes('budowa') || e.includes('realizacja')) return 'Budowa trwa';
  return null;
}

const BRANZE_WZORCE = [
  ['Motoryzacja', /automotive|motoryzac|samochod|fiat|opel|volvo|czesci|części/i],
  ['Logistyka', /logisty|magazyn|spedyc|transport/i],
  ['Poligrafia / opakowania', /poligraf|opakow|karton|folia|folie|druk|etykiet/i],
  ['Chemia / farmacja', /chemi|farmac|biotech|kosmet|lek[oó]w|świec|swiec|znicz/i],
  ['Spożywcza', /spożyw|spozyw|piekar|browar|mleczar|drobiar|mięs|mies|mrożon|mrozon|napoj|żywnoś|zywnos/i],
  ['Elektryka', /elektry|elektron|kabl|bateri|oświetl|oswietl/i],
  ['Meble', /mebl/i],
  ['Odzież', /odzież|odziez|tekstyl|obuw/i],
  ['Dom / wnętrze', /wnętrz|wnetrz|armatur|ogrodow|bram|drzwi|ogrodzeń|ogrodzen/i],
  ['Hotele', /hotel|pensjonat|resort/i],
  ['Przemysł', /przemysł|przemysl|produkc|fabryka|zakład|zaklad|hut[ay]|stal/i],
];

function wybierzE2({ branza, nazwa, informacje }) {
  if (branza) {
    const b = branza.toLowerCase();
    for (const [etykieta] of BRANZE_WZORCE) {
      if (etykieta.toLowerCase().split(' / ')[0].startsWith(b.split('/')[0].trim().slice(0, 5))) return { etykieta };
    }
    const mapa = { 'chemia/farmacja': 'Chemia / farmacja', 'spożywcza/fmcg': 'Spożywcza', 'logistyka': 'Logistyka', 'przemysł': 'Przemysł', 'elektryka': 'Elektryka', 'inna': 'Inna / brak dopasowania' };
    const m = mapa[b];
    if (m) return { etykieta: m };
  }
  const tekst = (normalizuj(nazwa) + ' ' + normalizuj(informacje)).toLowerCase();
  for (const [etykieta, wzor] of BRANZE_WZORCE) {
    if (wzor.test(tekst)) return { etykieta, weryfikacja: true };
  }
  return { etykieta: 'Inna / brak dopasowania', weryfikacja: true };
}

function wybierzE3(miasto, powiat) {
  const miasta = db.prepare(`SELECT wartosc FROM slowniki WHERE typ = 'miasto_referencyjne' AND aktywny = 1`).all()
    .map(r => r.wartosc.toLowerCase());
  const m = normalizuj(miasto).toLowerCase();
  const p = normalizuj(powiat).toLowerCase();
  if (m && miasta.includes(m)) return 'Miasto z realizacją WPIP';
  if (p && miasta.includes(p)) return 'Powiat z realizacją WPIP';
  return 'Brak bliskości';
}

function wybierzF({ nazwa, modernizacja }) {
  const n = normalizuj(nazwa).toLowerCase();
  if (normalizuj(modernizacja).toLowerCase() === 'tak' || n.includes('rozbudow') || n.includes('modernizacj') || /etap\s+(ii|iii|iv|2|3|4)/i.test(n)) {
    return 'Rozbudowa istniejącego zakładu';
  }
  return 'Nowa inwestycja';
}

// Wybor nazwy klienta z pola Inwestor (czesto lista firm; strefy/parki pomijamy)
function wybierzKlienta(inwestor) {
  const czesci = normalizuj(inwestor).split(/,\s+(?=[A-ZŻŹĆĄŚĘŁÓŃ0-9"„])/);
  const kandydat = czesci.find(c => !/strefa|invest-park|\bsse\b|agencja rozwoju/i.test(c));
  return normalizuj(kandydat || czesci[0] || '');
}

// ---------- API modulu ----------

export function parsujPlik(bufor, nazwaPliku) {
  const wb = XLSX.read(bufor, { type: 'buffer' });
  return {
    plik: nazwaPliku,
    zakladki: wb.SheetNames.map(nazwa => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nazwa], { header: 1, defval: '' });
      return { nazwa, wierszy: Math.max(0, rows.length - 1), naglowki: (rows[0] || []).map(normalizuj) };
    }),
  };
}

// Zwraca propozycje leadow (wybory A-F) dla wskazanej zakladki - bez liczenia punktow
// (punkty naliczy silnik scoringu wg wersji przypisanej do grupy)
export function przygotujImport(bufor, zakladka) {
  const wb = XLSX.read(bufor, { type: 'buffer' });
  const sheet = wb.Sheets[zakladka];
  if (!sheet) throw new Error(`Nie znaleziono zakładki "${zakladka}"`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length < 2) throw new Error('Zakładka nie zawiera danych');
  const nagl = rows[0].map(normalizuj);

  const kol = {
    id: znajdzKolumne(nagl, 'Id'),
    nazwa: znajdzKolumne(nagl, 'Nazwa'),
    inwestor: znajdzKolumne(nagl, 'Inwestor'),
    podsektor: znajdzKolumne(nagl, 'Podsektor'),
    wojewodztwo: znajdzKolumne(nagl, 'Województwo', 'Wojewodztwo'),
    miasto: znajdzKolumne(nagl, 'Miasto'),
    powiat: znajdzKolumne(nagl, 'Powiat'),
    etap: znajdzKolumne(nagl, 'Etap'),
    koszt: znajdzKolumne(nagl, 'Koszt (mln)', 'Koszt'),
    informacje: znajdzKolumne(nagl, 'Informacje', 'Komentarz'),
    czyPrywatna: znajdzKolumne(nagl, 'CzyPrywatna'),
    modernizacja: znajdzKolumne(nagl, 'Modernizacja'),
    powierzchnia: znajdzKolumne(nagl, 'Powierzchnia'),
    klasyfikacja: znajdzKolumne(nagl, 'Klasyfikacja'),
    branza: znajdzKolumne(nagl, 'Branża', 'Branza'),
    scoreZewn: znajdzKolumne(nagl, 'SCORE'),
    priorytetZewn: znajdzKolumne(nagl, 'Priorytet'),
    research: znajdzKolumne(nagl, 'Status researchu', 'Status weryfikacji'),
  };
  if (kol.nazwa < 0 && kol.inwestor < 0) {
    throw new Error('Nie rozpoznano formatu: brak kolumny "Nazwa" i "Inwestor". Nagłówki: ' + nagl.join(', '));
  }

  const w = (r, idx) => idx >= 0 ? normalizuj(r[idx]) : '';
  const propozycje = [];
  for (const r of rows.slice(1)) {
    const nazwa = w(r, kol.nazwa) || w(r, kol.inwestor);
    if (!nazwa) continue;
    const inwestor = w(r, kol.inwestor);
    const dane = {
      id_zrodlowe: w(r, kol.id) || null,
      nazwa_inwestycji: w(r, kol.nazwa) || nazwa,
      inwestor,
      klient_nazwa: wybierzKlienta(inwestor) || nazwa,
      podsektor: w(r, kol.podsektor),
      wojewodztwo: w(r, kol.wojewodztwo),
      miasto: w(r, kol.miasto) || w(r, kol.powiat),
      etap: w(r, kol.etap),
      koszt: w(r, kol.koszt),
      informacje: w(r, kol.informacje).slice(0, 500),
      powierzchnia: w(r, kol.powierzchnia),
      klasyfikacja: w(r, kol.klasyfikacja),
      branza: w(r, kol.branza),
      score_zewnetrzny: w(r, kol.scoreZewn) || null,
      priorytet_zewnetrzny: w(r, kol.priorytetZewn) || null,
      status_researchu_arkusz: w(r, kol.research) || null,
    };

    const c = wybierzC({ klasyfikacja: dane.klasyfikacja, czyPrywatna: w(r, kol.czyPrywatna), inwestor });
    const e2 = wybierzE2({ branza: dane.branza, nazwa: dane.nazwa_inwestycji, informacje: dane.informacje });

    dane.wybory = {
      A: wybierzA(dane.podsektor),
      B: wybierzB(dane.koszt),
      C: c.etykieta,
      D: wybierzD(dane.etap),
      E1: 'Województwo objęte bazą',
      E2: e2.etykieta,
      E3: wybierzE3(dane.miasto, w(r, kol.powiat)),
      F: wybierzF({ nazwa: dane.nazwa_inwestycji, modernizacja: w(r, kol.modernizacja) }),
    };
    dane.do_weryfikacji = !!(c.weryfikacja || e2.weryfikacja);
    propozycje.push(dane);
  }
  return { zakladka, naglowki: nagl, propozycje };
}
