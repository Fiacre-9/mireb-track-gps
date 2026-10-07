// Réception des positions par HTTP (protocole OsmAnd, utilisé par l'application Traccar Client et
// de nombreux boîtiers 4G configurables en HTTP). Fonctionne sur l'hébergement Node.js Hostinger.
const express = require('express');
const db = require('../db');
const engine = require('../engine');
const { num, str, safeEqual, asyncH } = require('../util');

const r = express.Router();

const handle = asyncH(async (req, res) => {
  const q = { ...req.query, ...req.body };
  const imei = str(String(q.id ?? q.deviceid ?? ''), 32);
  const token = String(q.token ?? '');
  const v = imei ? await db.get('SELECT v.*, c.status AS company_status FROM vehicles v JOIN companies c ON c.id = v.company_id WHERE v.imei = ?', [imei]) : null;
  if (!v || !safeEqual(v.token, token)) return res.status(401).json({ error: 'Appareil non autorisé' });
  if (v.company_status !== 'active') return res.status(403).json({ error: 'Entreprise suspendue' });

  const lat = num(q.lat, -90, 90), lng = num(q.lon ?? q.lng, -180, 180);
  if (lat === null || lng === null) return res.status(400).json({ error: 'Coordonnées invalides' });
  // OsmAnd/Traccar envoient la vitesse en nœuds ; passer unit=kmh pour des km/h
  let speed = num(q.speed, 0, 500) ?? 0;
  if (q.unit !== 'kmh') speed *= 1.852;
  let t = num(q.timestamp, 0, 9e15);
  if (t !== null && t < 1e11) t *= 1000; // secondes -> ms
  const now = Date.now();
  if (t === null || t > now + 60000 || t < now - 7 * 86400000) t = now;

  const acc = q.ignition === undefined ? undefined : (q.ignition === 'true' || q.ignition === '1' ? 1 : 0);
  const fuel = num(q.fuel, 0, 100) ?? undefined;
  const temp = num(q.temp, -60, 200) ?? undefined;
  await engine.processPosition(v, { lat, lng, speed, heading: num(q.bearing ?? q.heading, 0, 360) ?? undefined, t, acc, fuel, temp });
  res.json({ ok: true });
});

r.get('/osmand', handle);
r.post('/osmand', handle);
module.exports = r;
