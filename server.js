require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./src/db');
const A = require('./src/auth');
const engine = require('./src/engine');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // derrière le proxy Hostinger

// En-têtes de sécurité (Leaflet est servi localement : aucun script externe)
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Réception GPS : authentifiée par IMEI + jeton propre à chaque véhicule (pas de cookie, donc pas de CSRF)
app.use('/api/ingest', require('./src/routes/ingest'));

// API : CSRF puis connexion
app.use('/api', A.csrf);
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api', A.requireAuth, require('./src/routes/admin'), require('./src/routes/fleet'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
(async () => {
  await db.migrate();
  await require('./src/seed').seed();
  engine.startMaintenance();
  if (process.env.SIMULATOR === '1') require('./src/simulator').start();
  app.listen(PORT, () => console.log(`TrackFleet : http://localhost:${PORT} (base ${db.client})`));
})().catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
