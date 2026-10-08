require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// ---- PWA : le service worker reçoit un identifiant de version propre à chaque déploiement ----
const PUBLIC_DIR = path.join(__dirname, 'public');
function buildId() {
  if (process.env.BUILD_ID) return String(process.env.BUILD_ID).replace(/[^\w.-]/g, '').slice(0, 40);
  const h = crypto.createHash('sha1');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name !== 'sw.js') { h.update(p.slice(PUBLIC_DIR.length)); h.update(fs.readFileSync(p)); }
  });
  try { walk(PUBLIC_DIR); } catch { h.update(String(Date.now())); }
  return h.digest('hex').slice(0, 12);
}
const BUILD = buildId();
const SW_SOURCE = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8').replace('__BUILD__', BUILD);
app.get('/sw.js', (req, res) => {
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.send(SW_SOURCE);
});

app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist'), { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  setHeaders: (res, file) => {
    if (file.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    if (file.includes(`${path.sep}icons${path.sep}`)) res.set('Cache-Control', 'public, max-age=604800');
    else res.set('Cache-Control', 'no-cache'); // toujours revalidé (ETag) : une mise à jour est vue tout de suite
  }
}));

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
  // Boîtiers GT06 en TCP : uniquement sur un VPS (port TCP ouvert au pare-feu)
  if (process.env.GT06_PORT) require('./src/tcp/server').start(+process.env.GT06_PORT, process.env.GT06_HOST || '0.0.0.0');
  app.listen(PORT, () => console.log(`TrackFleet : http://localhost:${PORT} (base ${db.client})`));
})().catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
