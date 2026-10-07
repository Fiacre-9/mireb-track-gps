// Serveur TCP GT06 : à activer avec GT06_PORT (nécessite un VPS : l'hébergement Node.js mutualisé n'ouvre pas de port TCP).
const net = require('net');
const db = require('../db');
const engine = require('../engine');
const commands = require('../commands');
const gt06 = require('./gt06');

const { PROTO } = gt06;
const IDLE_MS = 15 * 60000;       // un boîtier envoie un battement de coeur toutes les 3 à 5 min
const LOGIN_TIMEOUT_MS = 30000;
const failures = new Map();       // ip -> { n, first } : connexions avec IMEI inconnu

const blocked = (ip) => { const f = failures.get(ip); return !!f && Date.now() - f.first < 10 * 60000 && f.n >= 20; };
function fail(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 10 * 60000) failures.set(ip, { n: 1, first: Date.now() });
  else f.n++;
}
const sane = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

async function loadVehicle(id) {
  const row = await db.get('SELECT v.*, c.status AS company_status FROM vehicles v JOIN companies c ON c.id = v.company_id WHERE v.id = ?', [id]);
  if (!row) return null;
  const { company_status, ...v } = row;
  return company_status === 'active' ? v : null;
}

async function handleFrame(st, f) {
  const sock = st.socket;

  if (f.proto === PROTO.LOGIN) {
    const imei = gt06.parseLogin(f.content);
    const row = imei && await db.get('SELECT v.id, c.status AS company_status FROM vehicles v JOIN companies c ON c.id = v.company_id WHERE v.imei = ?', [imei]);
    if (!row || row.company_status !== 'active') { fail(st.ip); sock.destroy(); return; }
    st.vehicleId = row.id;
    st.conn = { send: (b) => sock.write(b), close: () => sock.destroy(), nextSerial: () => (st.serial = (st.serial + 1) & 0xffff) };
    commands.register(row.id, st.conn);
    sock.write(gt06.buildAck(PROTO.LOGIN, f.serial));
    const v = await loadVehicle(row.id);
    if (v) await engine.processStatus(v, {});
    await commands.flushPending(row.id);
    return;
  }

  if (!st.vehicleId) { if (++st.preLogin > 5) sock.destroy(); return; } // aucune donnée avant le login
  const v = await loadVehicle(st.vehicleId);
  if (!v) { sock.destroy(); return; } // véhicule supprimé ou entreprise suspendue

  const usePos = async (pos) => {
    if (!pos) return v;
    if (!pos.valid || !sane(pos.lat, pos.lng)) return engine.processStatus(v, {});
    const now = Date.now();
    const t = pos.t <= now + 60000 && pos.t >= now - 7 * 86400000 ? pos.t : now;
    return engine.processPosition(v, { lat: pos.lat, lng: pos.lng, speed: pos.speed, heading: pos.heading, t, acc: pos.acc });
  };

  switch (f.proto) {
    case PROTO.GPS:
    case PROTO.GPS_10:
    case PROTO.GPS_22:
      await usePos(gt06.parseGps(f.proto, f.content));
      break;
    case PROTO.STATUS: {
      sock.write(gt06.buildAck(PROTO.STATUS, f.serial));
      const s = gt06.parseStatus(f.content);
      if (s) await engine.processStatus(v, {
        acc: s.acc, voltage: s.voltage, alarm: s.alarm,
        cut: commands.inFlightFor(v.id) ? undefined : s.cut // l'état réel du boîtier fait foi, sauf commande en cours
      });
      break;
    }
    case PROTO.ALARM: {
      sock.write(gt06.buildAck(PROTO.ALARM, f.serial));
      const a = gt06.parseAlarm(f.content);
      if (!a) break;
      const next = await usePos(a.pos);
      if (a.status) await engine.processStatus(next, {
        acc: a.status.acc, voltage: a.status.voltage, alarm: a.alarm,
        cut: commands.inFlightFor(v.id) ? undefined : a.status.cut
      });
      break;
    }
    case PROTO.CMD_REPLY:
    case PROTO.CMD_REPLY_2: {
      const r = gt06.parseCommandReply(f.proto, f.content);
      if (r) await commands.onReply(v, r.flag, r.text);
      break;
    }
    default: return; // protocole non géré : ignoré
  }
  await commands.flushPending(v.id); // une coupure en attente part dès que le véhicule est arrêté
}

function onConnection(socket) {
  const ip = socket.remoteAddress;
  if (blocked(ip)) { socket.destroy(); return; }
  const st = { socket, ip, buf: Buffer.alloc(0), vehicleId: null, conn: null, serial: 0x1000, preLogin: 0, chain: Promise.resolve() };
  socket.setNoDelay(true);
  socket.setTimeout(IDLE_MS, () => socket.destroy());
  const loginTimer = setTimeout(() => { if (!st.vehicleId) socket.destroy(); }, LOGIN_TIMEOUT_MS);
  loginTimer.unref();

  socket.on('data', (chunk) => {
    // Les trames sont traitées l'une après l'autre pour garder l'ordre des positions
    st.chain = st.chain.then(async () => {
      st.buf = Buffer.concat([st.buf, chunk]);
      const { frames, rest } = gt06.extractFrames(st.buf);
      st.buf = rest.length > 2048 ? Buffer.alloc(0) : Buffer.from(rest);
      for (const f of frames) {
        if (socket.destroyed) break;
        try { await handleFrame(st, f); } catch (e) { console.error('[gt06]', e.message); }
      }
    });
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    clearTimeout(loginTimer);
    if (st.vehicleId && st.conn) commands.unregister(st.vehicleId, st.conn);
  });
}

function start(port, host = '0.0.0.0') {
  const srv = net.createServer(onConnection);
  srv.on('error', (e) => console.error('[gt06] serveur TCP :', e.message));
  srv.listen(port, host, () => console.log(`[gt06] écoute TCP sur ${host}:${srv.address().port}`));
  return srv;
}
module.exports = { start };
