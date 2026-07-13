// Import realnego pipeline'u z arkusza "Pipeline i kluczowe dzialania" (kolumny K. Latosia).
// Etap interpretowany z "Prawdopodobienstwo wygranej" -> kamien, w ktorego pasmo wpada %.
import * as XLSX from 'xlsx';

const norm = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const serialNaDate = (n) => {
  const v = Number(n);
  if (!v || isNaN(v)) return null;
  return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
};

// Nazwa klienta z pola Inwestor: czesc przed " - " (lokalizacja/obiekt), zachowaj grupy z "/"
function nazwaKlienta(inwestor) {
  return norm(inwestor).split(/\s+-\s+/)[0].trim();
}

// Osoba decyzyjna z "Relacja z decydentem": rozdziel nazwisko od stanowiska
function parsujOsobe(relacja) {
  const r = norm(relacja).replace(/\(.*?\)/g, '').trim();
  if (!r) return null;
  const czesci = r.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
  const wygladaJakNazwisko = (s) => /^[A-ZŻŹĆĄŚĘŁÓŃ][a-ząćęłńóśźż]+([ ,].*)?$/.test(s) && !/prezes|zarząd|zarzad|dyrektor|manager|kierownik|inspektor|właściciel|wlasciciel|ds\./i.test(s);
  let imie_nazwisko = czesci.find(wygladaJakNazwisko) || czesci[czesci.length - 1] || r;
  const stanowisko = czesci.filter(c => c !== imie_nazwisko).join(' / ') || null;
  const rola = /prezes|zarząd|zarzad|właściciel|wlasciciel|dyrektor/i.test(stanowisko || r) ? 'decydent'
    : /inspektor|manager|kierownik|ds\./i.test(stanowisko || '') ? 'wpływowy' : 'decydent';
  return { imie_nazwisko: imie_nazwisko.trim(), stanowisko, rola_w_decyzji: rola };
}

function modelRealizacji(rodzaj) {
  const r = norm(rodzaj).toLowerCase();
  if (/\bzb\b/.test(r)) return 'Zaprojektuj i buduj';
  return 'Generalne wykonawstwo';
}

// Parsuje arkusz Pipeline -> lista surowych pozycji (bez interpretacji kamieni)
export function parsujPipeline(bufor) {
  const wb = XLSX.read(bufor, { type: 'buffer' });
  const sheet = wb.Sheets['Pipeline'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // znajdz wiersz naglowka (zawiera "Inwestor")
  let hi = rows.findIndex(r => r.some(c => /^inwestor$/i.test(norm(c))));
  if (hi < 0) hi = 3;
  const nagl = rows[hi].map(norm);
  const col = (nazwa) => nagl.findIndex(n => n.toLowerCase().startsWith(nazwa.toLowerCase()));
  const c = {
    inwestor: col('Inwestor'), rodzaj: col('Rodzaj inwest'), relacja: col('Relacja z decydentem'),
    wartosc: col('Wartość inwest'), marza: col('Szacunkowa marża'), oferta: col('Orientacyjny termin złoż'),
    start: col('Orientacyjny termin rozpocz'), czas: col('Czas trwania'), prawd: col('Prawdopodobieństwo'),
  };

  const pozycje = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const inwestor = norm(r[c.inwestor]);
    if (!inwestor || /razem|suma|pipeline/i.test(inwestor)) continue;
    const prawdFrac = Number(r[c.prawd]);
    pozycje.push({
      inwestor,
      klient_nazwa: nazwaKlienta(inwestor),
      rodzaj: norm(r[c.rodzaj]),
      osoba: parsujOsobe(r[c.relacja]),
      wartosc: Number(r[c.wartosc]) || null,
      marza_pct: r[c.marza] ? Math.round(Number(r[c.marza]) * 100) : null,
      termin_oferty: serialNaDate(r[c.oferta]),
      termin_realizacji: serialNaDate(r[c.start]),
      czas_trwania_mies: Number(r[c.czas]) || null,
      prawd_pct: prawdFrac && !isNaN(prawdFrac) ? Math.round(prawdFrac * 100) : null,
      model_realizacji: modelRealizacji(r[c.rodzaj]),
    });
  }
  return pozycje;
}
