// Flotte : véhicules, historique, rapports, alertes, géoclôtures, télécommande, flux temps réel.
const express = require('express');
const db = require('../db');
const A = require('../auth');
const hub = require('../hub');
const engine = require('../engine');
const { computeStats } = require('../reports');
const { num, str, newToken, asyncH } = require('../util');

const r = express.Router();
const CA = A.requireRole('super_admin', 'company_admin');
const DAY = 86400000;

async function ownVehicle(req, res) {
  const v = await db.get('SELECT * FROM vehicles WHERE id = ? AND company_id = ?', [+req.params.id, req.cid]);
  if (!v) res.status(404).json({ error: 'Véhicule introuvable' });
  return v;
}
function range(req) {
  const to = num(req.query.to, 0, 9e15) ?? Date.now();
  const from = num(req.query.from, 0, 9e15) ?? to - DAY;
  return { from, to: Math.min(to, from + 31 * DAY) };
}

// ---- Temps réel ----
r.get('/stream', A.needCompany, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const off = hub.add(res, req.cid);
  req.on('close', off);
});

// ---- Véhicules ----
r.get('/vehicles', A.needCompany, asyncH(async (req, res) => {
  const rows = await db.all('SELECT * FROM vehicles WHERE company_id = ? ORDER BY name', [req.cid]);
  res.json(rows.map(engine.pub));
}));

r.get('/vehicles/:id', A.needCompany, asyncH(async (req, res) => {
  const v = await ownVehicle(req, res); if (!v) return;
  // Le jeton d'ingestion n'est visible que des administrateurs
  res.json(req.user.role === 'user' ? engine.pub(v) : v);
}));

r.post('/vehicles', CA, A.needCompany, asyncH(async (req, res) => {
  const b = req.body;
  const name = str(b.name, 120), plate = b.plate ? str(b.plate, 40) : '', imei = str(String(b.imei ?? ''), 32, 4);
  const limit = b.speed_limit === undefined || b.speed_limit === '' ? 80 : num(b.speed_limit, 10, 250);
  if (!name || plate === null || !imei || !/^[A-Za-z0-9_-]+$/.test(imei) || limit === null)
    return res.status(400).json({ error: 'Nom, IMEI/identifiant (4-32 caractères alphanumériques) et limite de vitesse valides requis' });
  if (await db.get('SELECT id FROM vehicles WHERE imei = ?', [imei])) return res.status(409).json({ error: 'Cet IMEI est déjà enregistré' });
  const v = await db.run('INSERT INTO vehicles (company_id, name, plate, imei, token, speed_limit, created_at) VALUES (?,?,?,?,?,?,?)',
    [req.cid, name, plate, imei, newToken(), limit, Date.now()]);
  res.status(201).json({ id: v.insertId });
}));

r.patch('/vehicles/:id', CA, A.needCompany, asyncH(async (req, res) => {
  const v = await ownVehicle(req, res); if (!v) return;
  const b = req.body;
  const name = b.name !== undefined ? str(b.name, 120) : v.name;
  const plate = b.plate !== undefined ? (b.plate ? str(b.plate, 40) : '') : v.plate;
  const limit = b.speed_limit !== undefined ? num(b.speed_limit, 10, 250) : v.speed_limit;
  if (!name || plate === null || limit === null) return res.status(400).json({ error: 'Valeurs invalides' });
  await db.run('UPDATE vehicles SET name = ?, plate = ?, speed_limit = ? WHERE id = ?', [name, plate, limit, v.id]);
  res.json({ ok: true });
}));

r.delete('/vehicles/:id', CA, A.needCompany, asyncH(async (req, res) => {
  const v = await ownVehicle(req, res); if (!v) return;
  await db.run('DELETE FROM vehicles WHERE id = ?', [v.id]);
  res.json({ ok: true });
}));

// ---- Historique des trajets ----
r.get('/vehicles/:id/track', A.needCompany, asyncH(async (req, res) => {
  const v = await ownVehicle(req, res); if (!v) return;
  const { from, to } = range(req);
  let pts = await db.all('SELECT lat, lng, speed, t FROM positions WHERE vehicle_id = ? AND t BETWEEN ? AND ? ORDER BY t LIMIT 50000', [v.id, from, to]);
  const stats = computeStats(pts);
  if (pts.length > 3000) { const k = Math.ceil(pts.length / 3000); pts = pts.filter((_, i) => i % k === 0); }
  res.json({ from, to, points: pts, totalKm: stats.mileageKm });
}));

// ---- Rapport (jour / semaine / mois selon from-to) ----
r.get('/vehicles/:id/report', A.needCompany, asyncH(async (req, res) => {
  const v = await ownVehicle(req, res); if (!v) return;
  const { from, to } = range(req);
  const pts = await db.all('SELECT lat, lng, speed, t FROM positions WHERE vehicle_id = ? AND t BETWEEN ? AND ? ORDER BY t LIMIT 100000', [v.id, from, to]);
  const al = await db.all('SELECT type FROM alerts WHERE vehicle_id = ? AND t BETWEEN ? AND ?', [v.id, from, to]);
  res.json({ vehicle: v.name, plate: v.plate, from, to, ...computeStats(pts), alertCount: al.length, alertTypes: new Set(al.map((a) => a.type)).size });
}));

// ---- Alertes ----
r.get('/alerts', A.needCompany, asyncH(async (req, res) => {
  const p = [req.cid];
  let sql = `SELECT a.id, a.vehicle_id, v.name AS vehicle, v.plate, a.type, a.detail, a.lat, a.lng, a.t
             FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.company_id = ?`;
  if (req.query.type) { sql += ' AND a.type = ?'; p.push(String(req.query.type).slice(0, 30)); }
  if (req.query.vehicleId) { sql += ' AND a.vehicle_id = ?'; p.push(+req.query.vehicleId || 0); }
  sql += ' ORDER BY a.t DESC LIMIT 100';
  res.json(await db.all(sql, p));
}));

// ---- Géoclôtures ----
r.get('/geofences', A.needCompany, asyncH(async (req, res) => {
  res.json(await db.all('SELECT * FROM geofences WHERE company_id = ? ORDER BY name', [req.cid]));
}));
r.post('/geofences', CA, A.needCompany, asyncH(async (req, res) => {
  const b = req.body;
  const name = str(b.name, 120), lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180), radius = num(b.radius, 50, 50000);
  const sl = b.speed_limit ? num(b.speed_limit, 5, 250) : null;
  if (!name || lat === null || lng === null || radius === null || (b.speed_limit && sl === null))
    return res.status(400).json({ error: 'Nom, position, rayon (50 m – 50 km) valides requis' });
  const g = await db.run('INSERT INTO geofences (company_id, name, lat, lng, radius, on_enter, on_exit, cut_on_exit, speed_limit) VALUES (?,?,?,?,?,?,?,?,?)',
    [req.cid, name, lat, lng, Math.round(radius), b.on_enter ? 1 : 0, b.on_exit ? 1 : 0, b.cut_on_exit ? 1 : 0, sl]);
  engine.invalidateFences(req.cid);
  res.status(201).json({ id: g.insertId });
}));
r.delete('/geofences/:id', CA, A.needCompany, asyncH(async (req, res) => {
  const g = await db.run('DELETE FROM geofences WHERE id = ? AND company_id = ?', [+req.params.id, req.cid]);
  if (!g.affected) return res.status(404).json({ error: 'Zone introuvable' });
  engine.invalidateFences(req.cid);
  res.json({ ok: true });
}));

// ---- Télécommande ----
// Enregistre la commande et l'état demandé. L'exécution réelle sur un boîtier dépend de son protocole
// (couche TCP à ajouter sur un VPS) ; avec le simulateur, la commande est appliquée immédiatement.
r.post('/vehicles/:id/command', CA, A.needCompany, asyncH(async (req, res) => {
  const v = await ownVehicle(req, res); if (!v) return;
  const c = req.body.command;
  if (!['cut', 'restore'].includes(c)) return res.status(400).json({ error: 'Commande inconnue (cut | restore)' });
  const cut = c === 'cut' ? 1 : 0;
  await db.run('UPDATE vehicles SET cut = ? WHERE id = ?', [cut, v.id]);
  await db.run('INSERT INTO commands (company_id, vehicle_id, user_id, command, status, t) VALUES (?,?,?,?,?,?)',
    [req.cid, v.id, req.user.id, c, 'sent', Date.now()]);
  const next = { ...v, cut };
  await engine.addAlert(next, c, c === 'cut' ? `Coupure envoyée par ${req.user.name}` : `Rétablissement envoyé par ${req.user.name}`, true);
  require('../hub').emit(req.cid, 'vehicle', engine.pub(next));
  res.json({ ok: true });
}));

module.exports = r;
