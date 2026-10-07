const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const A = require('../auth');
const { str, isEmail, asyncH } = require('../util');

const r = express.Router();
const DUMMY = bcrypt.hashSync('dummy-password', 11); // égalise le temps de réponse si l'e-mail n'existe pas

async function me(userId) {
  const u = await db.get(
    `SELECT u.id, u.name, u.email, u.role, u.lang, u.company_id,
            c.name AS company_name, c.brand_name, c.brand_color, c.logo_url
     FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?`, [userId]);
  return u;
}

r.post('/login', asyncH(async (req, res) => {
  const email = str(req.body.email, 191), password = str(req.body.password, 200);
  if (!email || !password) return res.status(400).json({ error: 'E-mail et mot de passe requis' });
  const key = `${req.ip}|${email.toLowerCase()}`;
  if (A.loginBlocked(key)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });

  const u = await db.get('SELECT u.*, c.status AS company_status FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.email = ?', [email.toLowerCase()]);
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY);
  if (!u || !ok || !u.active) { A.loginFailed(key); return res.status(401).json({ error: 'Identifiants incorrects' }); }
  if (u.company_id && u.company_status !== 'active') return res.status(403).json({ error: 'Entreprise suspendue. Contactez l\'administrateur.' });
  A.loginOk(key);
  A.setSession(res, u);
  res.json({ user: await me(u.id) });
}));

r.post('/logout', (req, res) => { A.clearSession(res); res.json({ ok: true }); });

r.get('/me', A.requireAuth, asyncH(async (req, res) => res.json({ user: await me(req.user.id) })));

r.post('/password', A.requireAuth, asyncH(async (req, res) => {
  const cur = str(req.body.current, 200), next = str(req.body.next, 200, 8);
  if (!cur || !next) return res.status(400).json({ error: 'Nouveau mot de passe : 8 caractères minimum' });
  const u = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(cur, u.password_hash))) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(next, 11), req.user.id]);
  res.json({ ok: true });
}));

r.post('/lang', A.requireAuth, asyncH(async (req, res) => {
  const lang = ['fr', 'en'].includes(req.body.lang) ? req.body.lang : null;
  if (!lang) return res.status(400).json({ error: 'Langue invalide' });
  await db.run('UPDATE users SET lang = ? WHERE id = ?', [lang, req.user.id]);
  res.json({ ok: true });
}));

module.exports = r;
