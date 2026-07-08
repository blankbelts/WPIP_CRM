// WPIP CRM - serwer aplikacji (Express + node:sqlite)
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { wymagajSesji, trasyAuth, seedUzytkownika } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Railway/proxy - poprawne req.secure dla cookie Secure

seedUzytkownika();
trasyAuth(api);

app.use(express.json({ limit: '30mb' })); // import XLSX przesylany jako base64
app.use('/api', wymagajSesji, api);
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback - kazda sciezka nie-API zwraca index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Blad serwera' });
});

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => {
  console.log(`WPIP CRM dziala: http://localhost:${PORT}`);
});
