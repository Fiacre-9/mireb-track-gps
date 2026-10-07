// Protocole GT06 (Concox et nombreux clones) : extraction de trames, CRC, décodage et encodage.
//
// Trame courte :  78 78 | LEN | PROTO | CONTENU... | SERIE(2) | CRC(2) | 0D 0A
//   LEN = PROTO + CONTENU + SERIE + CRC (en octets) ; CRC-ITU (X25) calculé de LEN à SERIE.
// Trame étendue : 79 79 | LEN(2) | PROTO | ... même principe.
//
// Les fonctions d'encodage « côté boîtier » (login, position, état...) servent au simulateur et aux tests.

const START = [0x78, 0x78];
const STOP = [0x0d, 0x0a];

const PROTO = {
  LOGIN: 0x01,
  GPS_10: 0x10,
  GPS: 0x12,
  STATUS: 0x13,
  GPS_22: 0x22,
  ALARM: 0x16,
  CMD_REPLY: 0x15,
  CMD_REPLY_2: 0x21,
  COMMAND: 0x80
};

// CRC-16/X25 (polynôme 0x1021 inversé, init 0xFFFF, xor final 0xFFFF)
function crc16(buf) {
  let crc = 0xffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return ~crc & 0xffff;
}
const u16 = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);

// ---- Construction d'une trame courte ----
function frame(proto, content, serial) {
  content = content || Buffer.alloc(0);
  const body = Buffer.concat([Buffer.from([1 + content.length + 2 + 2, proto]), content, u16(serial)]);
  return Buffer.concat([Buffer.from(START), body, u16(crc16(body)), Buffer.from(STOP)]);
}
const buildAck = (proto, serial) => frame(proto, null, serial);

// Commande serveur -> boîtier (0x80) : [longueur][drapeau serveur 4 octets][texte ASCII][langue 2 octets]
function encodeCommand(text, flag, serial) {
  const txt = Buffer.from(text, 'ascii');
  const f = Buffer.alloc(4); f.writeUInt32BE(flag >>> 0);
  return frame(PROTO.COMMAND, Buffer.concat([Buffer.from([4 + txt.length]), f, txt, Buffer.from([0x00, 0x02])]), serial);
}

// ---- Extraction des trames d'un flux TCP (gère fragments, collages, octets parasites, CRC faux) ----
// Analyse une trame à la position i : { status: 'ok' | 'incomplete' | 'bad', frame, total }
function parseAt(buf, i) {
  const b = buf[i];
  if ((b !== 0x78 && b !== 0x79) || i + 1 >= buf.length) return { status: i + 1 >= buf.length && (b === 0x78 || b === 0x79) ? 'incomplete' : 'bad' };
  if (buf[i + 1] !== b) return { status: 'bad' };
  const ext = b === 0x79;
  const hdr = ext ? 4 : 3;
  if (buf.length - i < hdr) return { status: 'incomplete' };
  const len = ext ? buf.readUInt16BE(i + 2) : buf[i + 2];
  const total = hdr + len + 2;
  if (len < 5 || total > 1100) return { status: 'bad' };
  if (buf.length - i < total) return { status: 'incomplete' };
  const f = buf.subarray(i, i + total);
  if (f[total - 2] !== 0x0d || f[total - 1] !== 0x0a || crc16(f.subarray(2, total - 4)) !== f.readUInt16BE(total - 4)) return { status: 'bad' };
  return { status: 'ok', total, frame: { proto: f[hdr], content: f.subarray(hdr + 1, total - 6), serial: f.readUInt16BE(total - 6), ext } };
}

function extractFrames(buf) {
  const frames = [];
  let i = 0;
  while (i < buf.length) {
    const r = parseAt(buf, i);
    if (r.status === 'ok') { frames.push(r.frame); i += r.total; continue; }
    if (r.status === 'incomplete') {
      // Un faux début de trame (octet parasite) ne doit pas bloquer une vraie trame complète placée après lui
      let k = i + 1;
      while (k < buf.length && !(buf[k] === 0x78 || buf[k] === 0x79 ? parseAt(buf, k).status === 'ok' : false)) k++;
      if (k >= buf.length) break; // rien de valide plus loin : on attend la suite du flux
      i = k;
      continue;
    }
    i++; // octet parasite ou trame corrompue : on resynchronise
  }
  return { frames, rest: buf.subarray(i) };
}

// ---- Décodage ----
// Login : 8 octets BCD = IMEI sur 15 chiffres précédé d'un 0
function parseLogin(c) {
  if (c.length < 8) return null;
  const hex = c.subarray(0, 8).toString('hex');
  const imei = hex.replace(/^0/, '');
  return /^\d{15}$/.test(imei) ? imei : null;
}

// Position (0x10 / 0x12 / 0x22 / début de 0x16) : date UTC, satellites, latitude, longitude, vitesse, cap/état
function parseGps(proto, c) {
  if (c.length < 18) return null;
  const t = Date.UTC(2000 + c[0], c[1] - 1, c[2], c[3], c[4], c[5]);
  const s1 = c[16];
  let lat = c.readUInt32BE(7) / 1800000; // unités de 1/30000 de minute
  let lng = c.readUInt32BE(11) / 1800000;
  if (!(s1 & 0x04)) lat = -lat; // bit 2 : 1 = nord
  if (s1 & 0x08) lng = -lng;    // bit 3 : 1 = ouest
  const out = { valid: !!(s1 & 0x10), t, sats: c[6] & 0x0f, lat, lng, speed: c[15], heading: ((s1 & 0x03) << 8) | c[17] };
  if (proto === PROTO.GPS_22 && c.length > 26) out.acc = c[26] === 1;
  return out;
}

// État / battement de coeur (0x13) : octet d'état, niveau de batterie 0-6, signal GSM 0-4
const STATUS_ALARMS = { 1: 'vibration', 2: 'power_cut', 3: 'low_battery', 4: 'sos' };
function parseStatus(c) {
  if (c.length < 3) return null;
  const info = c[0];
  return {
    acc: !!(info & 0x40),
    cut: !!(info & 0x01), // 1 = huile/électricité coupées
    alarm: STATUS_ALARMS[(info >> 2) & 7] || null,
    voltage: c[1],
    gsm: c[2]
  };
}

// Alarme (0x16) : position + état + code d'alarme
const ALARM_CODES = { 0x01: 'sos', 0x02: 'power_cut', 0x03: 'vibration', 0x0e: 'low_battery', 0x0f: 'low_battery', 0x13: 'tamper' };
function parseAlarm(c) {
  const pos = parseGps(PROTO.ALARM, c);
  if (!pos) return null;
  const out = { pos, status: null, alarm: null };
  if (c.length >= 31) {
    out.status = parseStatus(c.subarray(27, 30));
    out.alarm = ALARM_CODES[c[30]] || (out.status && out.status.alarm) || null;
  }
  return out;
}

// Réponse du boîtier à une commande : 0x15 [long][drapeau 4][texte] ou 0x21 [drapeau 4][codage][texte]
function parseCommandReply(proto, c) {
  try {
    if (proto === PROTO.CMD_REPLY && c.length >= 5) {
      const n = c[0];
      const end = Math.min(c.length, 5 + Math.max(0, n - 4));
      return { flag: c.readUInt32BE(1), text: c.subarray(5, end).toString('latin1') };
    }
    if (proto === PROTO.CMD_REPLY_2 && c.length >= 5) return { flag: c.readUInt32BE(0), text: c.subarray(5).toString('latin1') };
  } catch { /* trame invalide */ }
  return null;
}

// ---- Encodeurs côté boîtier (simulateur, tests) ----
function encodeLogin(imei, serial) { return frame(PROTO.LOGIN, Buffer.from(String(imei).padStart(16, '0'), 'hex'), serial); }

function gpsContent(proto, p) {
  const d = new Date(p.t || Date.now());
  const c = Buffer.alloc(proto === PROTO.GPS_22 ? 33 : 26);
  [d.getUTCFullYear() - 2000, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].forEach((v, i) => { c[i] = v; });
  c[6] = 0xc0 | (p.sats ?? 9);
  c.writeUInt32BE(Math.round(Math.abs(p.lat) * 1800000), 7);
  c.writeUInt32BE(Math.round(Math.abs(p.lng) * 1800000), 11);
  c[15] = Math.min(255, Math.round(p.speed || 0));
  const heading = Math.round(p.heading || 0) & 0x3ff;
  let s1 = (heading >> 8) & 0x03;
  if (p.valid !== false) s1 |= 0x10;
  if (p.lat >= 0) s1 |= 0x04;
  if (p.lng < 0) s1 |= 0x08;
  c[16] = s1; c[17] = heading & 0xff;
  c.writeUInt16BE(0x01cc, 18); c[20] = 0; c.writeUInt16BE(0x287d, 21); c.writeUIntBE(0x1f71, 23, 3); // cellule fictive
  if (proto === PROTO.GPS_22) { c[26] = p.acc ? 1 : 0; c[27] = 1; c[28] = 0; }
  return c;
}
const encodeLocation = (proto, p, serial) => frame(proto, gpsContent(proto, p), serial);

function statusByte(s) { return ((s.acc ? 0x40 : 0) | ((s.alarmBits || 0) << 2) | 0x02 | (s.cut ? 0x01 : 0)) & 0xff; }
const encodeStatus = (s, serial) => frame(PROTO.STATUS, Buffer.from([statusByte(s), s.voltage ?? 5, s.gsm ?? 3, 0x00, 0x02]), serial);

function encodeAlarm(p, s, alarmCode, serial) {
  const gps = gpsContent(PROTO.GPS, p).subarray(0, 18);
  const lbs = Buffer.alloc(9); lbs[0] = 8; lbs.writeUInt16BE(0x01cc, 1); lbs[3] = 0; lbs.writeUInt16BE(0x287d, 4); lbs.writeUIntBE(0x1f71, 6, 3);
  return frame(PROTO.ALARM, Buffer.concat([gps, lbs, Buffer.from([statusByte(s), s.voltage ?? 5, s.gsm ?? 3, alarmCode, 0x02])]).subarray(0, 32), serial);
}

function encodeCommandReply(flag, text, serial) {
  const txt = Buffer.from(text, 'ascii');
  const f = Buffer.alloc(4); f.writeUInt32BE(flag >>> 0);
  return frame(PROTO.CMD_REPLY, Buffer.concat([Buffer.from([4 + txt.length]), f, txt, Buffer.from([0x00, 0x02])]), serial);
}

module.exports = {
  PROTO, crc16, frame, buildAck, encodeCommand, extractFrames,
  parseLogin, parseGps, parseStatus, parseAlarm, parseCommandReply,
  encodeLogin, encodeLocation, encodeStatus, encodeAlarm, encodeCommandReply
};
