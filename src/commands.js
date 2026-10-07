// Télécommande : file de commandes, envoi au boîtier connecté en TCP, accusé de réception.
//
// Statuts : pending (en attente) -> sent (envoyée) -> confirmed | failed | timeout ; expired si trop ancienne.
// Sécurité : une coupure carburant n'est jamais envoyée à un véhicule qui roule (> CUT_MAX_SPEED km/h) :
//  - demande d'un utilisateur : refusée tout de suite ;
//  - coupure automatique (sortie de zone) : mise en attente jusqu'à l'arrêt du véhicule.
const db = require('./db');
const hub = require('./hub');
const engine = require('./engine');
const gt06 = require('./tcp/gt06');

const CUT_MAX_SPEED = +process.env.CUT_MAX_SPEED || 20;
const TTL_MS = (+process.env.COMMAND_TTL_MINUTES || 60) * 60000;
const REPLY_TIMEOUT_MS = +process.env.COMMAND_REPLY_TIMEOUT_MS || 30000;
// Textes de commande GT06 (mot de passe par défaut 000000 ; adaptez à votre modèle de boîtier)
const CMD_TEXT = { cut: process.env.GT06_CMD_CUT || 'DYD,000000#', restore: process.env.GT06_CMD_RESTORE || 'HFYD,000000#' };
const LABEL = { cut: 'Coupure carburant', restore: 'Rétablissement' };

const conns = new Map();    // vehicleId -> { send(buf), close(), nextSerial() }
const inFlight = new Map(); // vehicleId -> { id, flag, command }
const flushing = new Set();
let nextFlag = Math.floor(Math.random() * 1e6);

class CmdError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function register(vehicleId, conn) {
  const old = conns.get(vehicleId);
  if (old && old !== conn) old.close();
  conns.set(vehicleId, conn);
}
function unregister(vehicleId, conn) {
  if (conns.get(vehicleId) === conn) { conns.delete(vehicleId); inFlight.delete(vehicleId); }
}
const isConnected = (vehicleId) => conns.has(vehicleId);
const inFlightFor = (vehicleId) => inFlight.get(vehicleId) || null;

const emitCmd = (companyId, vehicleId, row, extra) =>
  hub.emit(companyId, 'command', { vehicle_id: vehicleId, id: row.id, command: row.command, status: row.status, ...extra });
const setStatus = (id, status) => db.run('UPDATE commands SET status = ? WHERE id = ?', [status, id]);

async function setCut(v, cut) {
  await db.run('UPDATE vehicles SET cut = ? WHERE id = ?', [cut, v.id]);
  const next = { ...v, cut };
  hub.emit(v.company_id, 'vehicle', engine.pub(next));
  return next;
}

// Demande de commande. Renvoie { id, status }.
async function request(v, command, user, source = 'user', reason = '') {
  const who = user ? user.name : 'automatique';
  const why = reason ? ` (${reason})` : '';
  const now = Date.now();

  // Véhicules de démonstration : appliqué immédiatement
  if (String(v.imei).startsWith('SIM')) {
    const next = await setCut(v, command === 'cut' ? 1 : 0);
    const r = await db.run('INSERT INTO commands (company_id, vehicle_id, user_id, command, status, t) VALUES (?,?,?,?,?,?)',
      [v.company_id, v.id, user ? user.id : null, command, 'confirmed', now]);
    await engine.addAlert(next, command, `${LABEL[command]} par ${who}${why}`, true);
    emitCmd(v.company_id, v.id, { id: r.insertId, command, status: 'confirmed' });
    return { id: r.insertId, status: 'confirmed' };
  }

  if (command === 'cut' && source === 'user' && v.online && v.speed > CUT_MAX_SPEED)
    throw new CmdError(409, `Le véhicule roule à ${v.speed} km/h : coupure refusée au-dessus de ${CUT_MAX_SPEED} km/h.`);

  const dup = await db.get("SELECT id FROM commands WHERE vehicle_id = ? AND command = ? AND status = 'pending' AND t > ?", [v.id, command, now - TTL_MS]);
  if (dup) return { id: dup.id, status: 'pending' };
  const fl = inFlight.get(v.id);
  if (fl && fl.command === command) return { id: fl.id, status: 'sent' };

  const r = await db.run('INSERT INTO commands (company_id, vehicle_id, user_id, command, status, t) VALUES (?,?,?,?,?,?)',
    [v.company_id, v.id, user ? user.id : null, command, 'pending', now]);
  emitCmd(v.company_id, v.id, { id: r.insertId, command, status: 'pending' }, { detail: `${who}${why}` });
  await flushPending(v.id);
  const row = await db.get('SELECT status FROM commands WHERE id = ?', [r.insertId]);
  return { id: r.insertId, status: row ? row.status : 'pending' };
}

// Envoie la plus ancienne commande en attente si le boîtier est connecté et si les conditions sont réunies
async function flushPending(vehicleId) {
  const c = conns.get(vehicleId);
  if (!c || inFlight.has(vehicleId) || flushing.has(vehicleId)) return;
  flushing.add(vehicleId);
  try {
    const v = await db.get('SELECT * FROM vehicles WHERE id = ?', [vehicleId]);
    if (!v) return;
    const row = await db.get("SELECT * FROM commands WHERE vehicle_id = ? AND status = 'pending' AND t > ? ORDER BY id LIMIT 1", [vehicleId, Date.now() - TTL_MS]);
    if (!row) return;
    if (row.command === 'cut' && v.speed > CUT_MAX_SPEED) return; // on attend l'arrêt du véhicule
    nextFlag = (nextFlag + 1) >>> 0;
    const flag = nextFlag;
    inFlight.set(vehicleId, { id: row.id, flag, command: row.command });
    c.send(gt06.encodeCommand(CMD_TEXT[row.command], flag, c.nextSerial()));
    await setStatus(row.id, 'sent');
    emitCmd(v.company_id, vehicleId, { id: row.id, command: row.command, status: 'sent' });
    setTimeout(async () => {
      const f = inFlight.get(vehicleId);
      if (f && f.flag === flag) {
        inFlight.delete(vehicleId);
        await setStatus(row.id, 'timeout').catch(() => {});
        emitCmd(v.company_id, vehicleId, { id: row.id, command: row.command, status: 'timeout' });
      }
    }, REPLY_TIMEOUT_MS).unref();
  } finally { flushing.delete(vehicleId); }
}

// Réponse du boîtier (protocole 0x15 / 0x21)
async function onReply(v, flag, text) {
  const f = inFlight.get(v.id);
  if (!f || f.flag !== flag) return;
  inFlight.delete(v.id);
  const ok = /success|\bok\b/i.test(text) && !/fail|error/i.test(text);
  await setStatus(f.id, ok ? 'confirmed' : 'failed');
  if (ok) {
    const next = await setCut(v, f.command === 'cut' ? 1 : 0);
    await engine.addAlert(next, f.command, `${LABEL[f.command]} confirmée par le boîtier`, true);
  }
  emitCmd(v.company_id, v.id, { id: f.id, command: f.command, status: ok ? 'confirmed' : 'failed' }, { detail: text });
  await flushPending(v.id);
}

async function expire() {
  await db.run("UPDATE commands SET status = 'expired' WHERE status = 'pending' AND t <= ?", [Date.now() - TTL_MS]);
}

module.exports = { request, flushPending, onReply, register, unregister, isConnected, inFlightFor, expire, CmdError, CUT_MAX_SPEED };
