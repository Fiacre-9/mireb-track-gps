// Authentification : cookie de session JWT (HttpOnly), rôles, isolation par entreprise, protection CSRF.
const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET;
const PROD = process.env.NODE_ENV === 'production';
if (!SECRET || SECRET.length < 16 || (PROD && /change-me/i.test(SECRET))) {
  console.error('JWT_SECRET manquant ou trop faible (16 caractères minimum). Définissez-le dans les variables d\'environnement.');
  process.exit(1);
}
const COOKIE = 'tf_session';
const MAX_AGE = 12 * 3600 * 1000;
const SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : PROD;

function parseCookies(h) {
  const out = {};
  (h || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, SECRET, { expiresIn: '12h' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: SECURE, maxAge: MAX_AGE, path: '/' });
}
const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

// Les formulaires d'un autre site ne peuvent pas poser cet en-tête personnalisé : protection CSRF simple et efficace.
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-tf'] !== '1') return res.status(403).json({ error: 'Requête refusée' });
  next();
}

async function requireAuth(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return res.status(401).json({ error: 'Non connecté' });
    let payload;
    try { payload = jwt.verify(token, SECRET); } catch { return res.status(401).json({ error: 'Session expirée' }); }
    const user = await db.get(
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.lang, u.active, c.status AS company_status
       FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?`, [payload.uid]);
    if (!user || !user.active) return res.status(401).json({ error: 'Compte désactivé' });
    if (user.company_id && user.company_status !== 'active') return res.status(403).json({ error: 'Entreprise suspendue' });
    req.user = user;
    // Super admin : choisit l'entreprise à consulter via l'en-tête x-company
    const asked = parseInt(req.headers['x-company'] || req.query.company, 10);
    req.cid = user.company_id || (user.role === 'super_admin' && asked > 0 ? asked : null);
    next();
  } catch (e) { next(e); }
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Droits insuffisants' });
// Impose qu'une entreprise soit ciblée (utile au super admin)
function needCompany(req, res, next) {
  if (!req.cid) return res.status(400).json({ error: 'Sélectionnez une entreprise' });
  next();
}

// Limiteur de tentatives de connexion (mémoire) : 8 échecs / 15 min par IP+email
const fails = new Map();
const LIMIT = 8, WINDOW = 15 * 60000;
function loginBlocked(key) {
  const f = fails.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW) { fails.delete(key); return false; }
  return f.n >= LIMIT;
}
function loginFailed(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first > WINDOW) fails.set(key, { n: 1, first: Date.now() });
  else f.n++;
}
const loginOk = (key) => fails.delete(key);

module.exports = { setSession, clearSession, csrf, requireAuth, requireRole, needCompany, loginBlocked, loginFailed, loginOk };
