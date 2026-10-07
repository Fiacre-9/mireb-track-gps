// Entreprises (super admin), marque personnalisée et utilisateurs.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const A = require('../auth');
const { str, isEmail, isHex, httpsUrl, asyncH } = require('../util');

const r = express.Router();
const SA = A.requireRole('super_admin');
const ADMINS = A.requireRole('super_admin', 'company_admin');

// ---- Entreprises ----
r.get('/companies', SA, asyncH(async (req, res) => {
  res.json(await db.all(
    `SELECT c.*, (SELECT COUNT(*) FROM vehicles v WHERE v.company_id = c.id) AS vehicles,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS users
     FROM companies c ORDER BY c.name`));
}));

r.post('/companies', SA, asyncH(async (req, res) => {
  const b = req.body;
  const name = str(b.name, 120), aName = str(b.adminName, 120), aEmail = str(b.adminEmail, 191), aPw = str(b.adminPassword, 200, 8);
  if (!name || !aName || !isEmail(aEmail) || !aPw) return res.status(400).json({ error: 'Nom, administrateur (nom, e-mail valide, mot de passe 8+ caractères) requis' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [aEmail.toLowerCase()])) return res.status(409).json({ error: 'Cet e-mail existe déjà' });
  const c = await db.run('INSERT INTO companies (name, status, created_at) VALUES (?,?,?)', [name, 'active', Date.now()]);
  await db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)',
    [c.insertId, aName, aEmail.toLowerCase(), bcrypt.hashSync(aPw, 11), 'company_admin', Date.now()]);
  res.status(201).json({ id: c.insertId });
}));

r.patch('/companies/:id', SA, asyncH(async (req, res) => {
  const id = +req.params.id, b = req.body;
  const c = await db.get('SELECT * FROM companies WHERE id = ?', [id]);
  if (!c) return res.status(404).json({ error: 'Entreprise introuvable' });
  const name = b.name !== undefined ? str(b.name, 120) : c.name;
  const status = b.status !== undefined ? (['active', 'suspended'].includes(b.status) ? b.status : null) : c.status;
  if (!name || !status) return res.status(400).json({ error: 'Valeurs invalides' });
  await db.run('UPDATE companies SET name = ?, status = ? WHERE id = ?', [name, status, id]);
  res.json({ ok: true });
}));

// ---- Marque personnalisée (nom, couleur, logo) ----
r.patch('/brand', A.requireRole('company_admin', 'super_admin'), A.needCompany, asyncH(async (req, res) => {
  const b = req.body;
  const brandName = b.brand_name ? str(b.brand_name, 120) : null;
  const color = b.brand_color ? (isHex(b.brand_color) ? b.brand_color : null) : '#2563eb';
  const logo = b.logo_url ? httpsUrl(b.logo_url) : null;
  if ((b.brand_name && !brandName) || !color || (b.logo_url && !logo)) return res.status(400).json({ error: 'Nom, couleur (#RRGGBB) ou logo (URL https) invalide' });
  await db.run('UPDATE companies SET brand_name = ?, brand_color = ?, logo_url = ? WHERE id = ?', [brandName, color, logo, req.cid]);
  res.json({ ok: true });
}));

// ---- Utilisateurs ----
r.get('/users', ADMINS, asyncH(async (req, res) => {
  const where = req.cid ? 'WHERE u.company_id = ?' : '';
  res.json(await db.all(
    `SELECT u.id, u.company_id, u.name, u.email, u.role, u.active, c.name AS company_name
     FROM users u LEFT JOIN companies c ON c.id = u.company_id ${where} ORDER BY u.name`, req.cid ? [req.cid] : []));
}));

r.post('/users', ADMINS, asyncH(async (req, res) => {
  const b = req.body;
  const name = str(b.name, 120), email = str(b.email, 191), pw = str(b.password, 200, 8);
  const role = ['company_admin', 'user'].includes(b.role) ? b.role : null;
  if (!name || !isEmail(email) || !pw || !role) return res.status(400).json({ error: 'Nom, e-mail valide, mot de passe (8+) et rôle requis' });
  if (!req.cid) return res.status(400).json({ error: 'Sélectionnez une entreprise' });
  if (await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()])) return res.status(409).json({ error: 'Cet e-mail existe déjà' });
  const u = await db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)',
    [req.cid, name, email.toLowerCase(), bcrypt.hashSync(pw, 11), role, Date.now()]);
  res.status(201).json({ id: u.insertId });
}));

async function targetUser(req, res) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [+req.params.id]);
  // Un admin d'entreprise ne touche qu'à sa propre entreprise ; personne ne touche au super admin ici
  if (!u || u.role === 'super_admin' || (req.user.role !== 'super_admin' && u.company_id !== req.user.company_id)) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return null;
  }
  return u;
}
r.patch('/users/:id', ADMINS, asyncH(async (req, res) => {
  const u = await targetUser(req, res); if (!u) return;
  const b = req.body;
  const name = b.name !== undefined ? str(b.name, 120) : u.name;
  const role = b.role !== undefined ? (['company_admin', 'user'].includes(b.role) ? b.role : null) : u.role;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;
  if (!name || !role) return res.status(400).json({ error: 'Valeurs invalides' });
  if (u.id === req.user.id && (!active || role !== u.role)) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle ou statut' });
  let hash = u.password_hash;
  if (b.password) { const pw = str(b.password, 200, 8); if (!pw) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' }); hash = bcrypt.hashSync(pw, 11); }
  await db.run('UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?', [name, role, active, hash, u.id]);
  res.json({ ok: true });
}));
r.delete('/users/:id', ADMINS, asyncH(async (req, res) => {
  const u = await targetUser(req, res); if (!u) return;
  if (u.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous supprimer' });
  await db.run('DELETE FROM users WHERE id = ?', [u.id]);
  res.json({ ok: true });
}));

module.exports = r;
