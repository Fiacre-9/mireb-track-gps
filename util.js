const crypto = require('crypto');

const rad = (d) => (d * Math.PI) / 180;
function distM(a, b) {
  const R = 6371000;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Validation : renvoient null si invalide
function num(v, min, max) {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function str(v, max, min = 1) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
}
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
function httpsUrl(v) {
  try { const u = new URL(v); return u.protocol === 'https:' && v.length <= 500 ? u.toString() : null; } catch { return null; }
}
const isEmail = (v) => typeof v === 'string' && v.length <= 191 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const newToken = () => crypto.randomBytes(12).toString('hex');
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { distM, num, str, isHex, httpsUrl, isEmail, safeEqual, newToken, asyncH };
