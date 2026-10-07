// Tests : décodeur GT06 (unitaires) + serveur TCP et télécommande (intégration avec un faux boîtier).
// Lancer : npm test   (SQLite temporaire, aucun MySQL requis)
const os = require('os');
const path = require('path');
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_FILE = process.env.SQLITE_FILE || path.join(os.tmpdir(), `trackfleet-test-${process.pid}.db`);
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.COMMAND_REPLY_TIMEOUT_MS = '400';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const gt06 = require('../src/tcp/gt06');
const db = require('../src/db');
const commands = require('../src/commands');
const { newToken } = require('../src/util');

const { PROTO } = gt06;
const KIN = { lat: -4.325, lng: 15.322 };

// ---------- Unitaires ----------
test('CRC-16/X25 : valeur de contrôle standard et trames de la documentation', () => {
  assert.equal(gt06.crc16(Buffer.from('123456789')), 0x906e);
  assert.equal(gt06.crc16(Buffer.from('0D0101234567890123450001', 'hex')), 0x8cdd); // login (doc GT06)
  assert.equal(gt06.crc16(Buffer.from('05010001', 'hex')), 0xd9dc);                 // réponse login (doc GT06)
  assert.equal(gt06.buildAck(PROTO.LOGIN, 1).toString('hex'), '78780501000 1d9dc0d0a'.replace(' ', ''));
});

test('extraction : fragments, trames collées, octets parasites, CRC faux', () => {
  const a = gt06.encodeLogin('861234567890123', 1);
  const b = gt06.encodeStatus({ acc: true }, 2);
  const stream = Buffer.concat([Buffer.from([0x00, 0xff, 0x78]), a, b]);
  let r = gt06.extractFrames(stream);
  assert.deepEqual(r.frames.map((f) => f.proto), [PROTO.LOGIN, PROTO.STATUS]);
  assert.equal(r.rest.length, 0);
  // fragmenté en deux morceaux
  r = gt06.extractFrames(stream.subarray(0, 12));
  assert.equal(r.frames.length, 0);
  const r2 = gt06.extractFrames(Buffer.concat([r.rest, stream.subarray(12)]));
  assert.equal(r2.frames.length, 2);
  // CRC corrompu : la trame est rejetée, la suivante reste lisible
  const bad = Buffer.from(a); bad[bad.length - 4] ^= 0xff;
  assert.deepEqual(gt06.extractFrames(Buffer.concat([bad, b])).frames.map((f) => f.proto), [PROTO.STATUS]);
});

test('login : IMEI sur 15 chiffres', () => {
  const f = gt06.extractFrames(gt06.encodeLogin('861234567890123', 9)).frames[0];
  assert.equal(f.serial, 9);
  assert.equal(gt06.parseLogin(f.content), '861234567890123');
  assert.equal(gt06.parseLogin(Buffer.from('ffffffffffffffff', 'hex')), null);
});

test('position : hémisphère sud / est (Kinshasa), vitesse, cap, contact', () => {
  const t = Date.UTC(2026, 9, 7, 5, 0, 0);
  for (const proto of [PROTO.GPS, PROTO.GPS_22]) {
    const f = gt06.extractFrames(gt06.encodeLocation(proto, { t, ...KIN, speed: 42, heading: 270, acc: true }, 3)).frames[0];
    const p = gt06.parseGps(proto, f.content);
    assert.equal(p.valid, true);
    assert.equal(p.t, t);
    assert.ok(Math.abs(p.lat - KIN.lat) < 1e-5 && Math.abs(p.lng - KIN.lng) < 1e-5);
    assert.equal(p.speed, 42);
    assert.equal(p.heading, 270);
    if (proto === PROTO.GPS_22) assert.equal(p.acc, true);
  }
  // hémisphère nord / ouest
  const f = gt06.extractFrames(gt06.encodeLocation(PROTO.GPS, { t, lat: 48.85, lng: -2.35, speed: 0 }, 1)).frames[0];
  const p = gt06.parseGps(PROTO.GPS, f.content);
  assert.ok(p.lat > 48 && p.lng < -2);
  // position non valide (pas de fix)
  const nf = gt06.extractFrames(gt06.encodeLocation(PROTO.GPS, { t, ...KIN, valid: false }, 1)).frames[0];
  assert.equal(gt06.parseGps(PROTO.GPS, nf.content).valid, false);
});

test('état et alarme', () => {
  const s = gt06.parseStatus(gt06.extractFrames(gt06.encodeStatus({ acc: true, cut: true, voltage: 1, alarmBits: 4 }, 1)).frames[0].content);
  assert.deepEqual({ acc: s.acc, cut: s.cut, alarm: s.alarm, voltage: s.voltage }, { acc: true, cut: true, alarm: 'sos', voltage: 1 });
  const a = gt06.parseAlarm(gt06.extractFrames(gt06.encodeAlarm({ t: Date.now(), ...KIN, speed: 5 }, { acc: true }, 0x02, 1)).frames[0].content);
  assert.equal(a.alarm, 'power_cut');
  assert.ok(Math.abs(a.pos.lat - KIN.lat) < 1e-5);
});

test('commande 0x80 : contenu et réponse 0x15', () => {
  const f = gt06.extractFrames(gt06.encodeCommand('DYD,000000#', 0xdeadbeef, 5)).frames[0];
  assert.equal(f.proto, PROTO.COMMAND);
  assert.equal(f.content[0], 4 + 'DYD,000000#'.length);
  assert.equal(f.content.readUInt32BE(1), 0xdeadbeef);
  assert.equal(f.content.subarray(5, 5 + 11).toString(), 'DYD,000000#');
  const r = gt06.extractFrames(gt06.encodeCommandReply(0xdeadbeef, 'DYD=Success!', 6)).frames[0];
  assert.deepEqual(gt06.parseCommandReply(r.proto, r.content), { flag: 0xdeadbeef, text: 'DYD=Success!' });
});

// ---------- Intégration : faux boîtier <-> serveur TCP ----------
class Device {
  constructor(port) {
    this.serial = 0; this.frames = []; this.buf = Buffer.alloc(0); this.closed = false; this.waiters = [];
    this.sock = net.connect(port, '127.0.0.1');
    this.sock.on('data', (d) => {
      const r = gt06.extractFrames(Buffer.concat([this.buf, d]));
      this.buf = Buffer.from(r.rest);
      this.frames.push(...r.frames);
      this.waiters.forEach((w) => w());
    });
    this.sock.on('close', () => { this.closed = true; this.waiters.forEach((w) => w()); });
    this.sock.on('error', () => {});
  }
  send(buf) { this.sock.write(buf); }
  next() { return ++this.serial; }
  async waitFor(pred, ms = 3000) {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.frames.findIndex(pred);
      if (i >= 0) return this.frames.splice(i, 1)[0];
      if (this.closed || Date.now() > end) return null;
      await new Promise((res) => { this.waiters.push(res); setTimeout(res, 50); });
    }
  }
  async waitClosed(ms = 3000) { const end = Date.now() + ms; while (!this.closed && Date.now() < end) await new Promise((r) => setTimeout(r, 30)); return this.closed; }
  close() { this.sock.destroy(); }
}
async function eventually(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 40)); }
}

let server, port, vehicle, vehicle2;
const getV = (id) => db.get('SELECT * FROM vehicles WHERE id = ?', [id]);

test('intégration : démarrage', async () => {
  await db.migrate();
  const c = await db.run('INSERT INTO companies (name, status, created_at) VALUES (?,?,?)', ['Test Co', 'active', Date.now()]);
  const mk = async (name, imei) => (await db.run('INSERT INTO vehicles (company_id, name, plate, imei, token, speed_limit, created_at) VALUES (?,?,?,?,?,?,?)',
    [c.insertId, name, 'T-1', imei, newToken(), 80, Date.now()])).insertId;
  vehicle = await mk('Boîtier 1', '861234567890123');
  vehicle2 = await mk('Boîtier 2', '861234567890999');
  server = require('../src/tcp/server').start(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
  assert.ok(port > 0);
});

test('IMEI inconnu : connexion fermée, aucune donnée acceptée avant le login', async () => {
  const d = new Device(port);
  d.send(gt06.encodeLogin('999999999999999', d.next()));
  assert.equal(await d.waitClosed(), true);
  const d2 = new Device(port);
  d2.send(gt06.encodeLocation(PROTO.GPS, { t: Date.now(), ...KIN, speed: 10 }, d2.next())); // sans login
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await db.all('SELECT id FROM positions')).length, 0);
  d2.close();
});

test('login, position, battement de coeur, position tamponnée', async () => {
  const d = new Device(port);
  d.send(gt06.encodeLogin('861234567890123', d.next()));
  const ack = await d.waitFor((f) => f.proto === PROTO.LOGIN);
  assert.ok(ack, 'accusé de login');
  assert.equal(ack.serial, 1);

  d.send(gt06.encodeLocation(PROTO.GPS_22, { t: Date.now(), ...KIN, speed: 10, heading: 90, acc: true }, d.next()));
  const v = await eventually(async () => { const x = await getV(vehicle); return x.lat != null && x; });
  assert.ok(v && v.online === 1 && v.speed === 10 && v.acc === 1);
  assert.ok(Math.abs(v.lat - KIN.lat) < 1e-4);

  d.send(gt06.encodeStatus({ acc: true, voltage: 5 }, d.next()));
  assert.ok(await d.waitFor((f) => f.proto === PROTO.STATUS), 'accusé du battement de coeur');

  // une position plus ancienne : historique oui, état courant inchangé
  const before = (await db.all('SELECT id FROM positions WHERE vehicle_id = ?', [vehicle])).length;
  d.send(gt06.encodeLocation(PROTO.GPS, { t: Date.now() - 600000, lat: -4.4, lng: 15.4, speed: 5 }, d.next()));
  await eventually(async () => (await db.all('SELECT id FROM positions WHERE vehicle_id = ?', [vehicle])).length > before);
  const v2 = await getV(vehicle);
  assert.ok(Math.abs(v2.lat - KIN.lat) < 1e-4, 'l\'état courant ne recule pas');
  d.close();
});

test('télécommande : refus à vitesse élevée, envoi, accusé, état coupé', async () => {
  const d = new Device(port);
  d.send(gt06.encodeLogin('861234567890123', d.next()));
  await d.waitFor((f) => f.proto === PROTO.LOGIN);

  // véhicule à 50 km/h : coupure refusée
  d.send(gt06.encodeLocation(PROTO.GPS, { t: Date.now(), ...KIN, speed: 50 }, d.next()));
  await eventually(async () => (await getV(vehicle)).speed === 50);
  await assert.rejects(commands.request(await getV(vehicle), 'cut', { id: null, name: 'test' }, 'user'), (e) => e.status === 409);

  // à l'arrêt : la commande part vers le boîtier
  d.send(gt06.encodeLocation(PROTO.GPS, { t: Date.now() + 1000, ...KIN, speed: 0 }, d.next()));
  await eventually(async () => (await getV(vehicle)).speed === 0);
  const r = await commands.request(await getV(vehicle), 'cut', { id: null, name: 'test' }, 'user');
  assert.equal(r.status, 'sent');
  const cmd = await d.waitFor((f) => f.proto === PROTO.COMMAND);
  assert.ok(cmd, 'le boîtier reçoit la commande 0x80');
  assert.equal(cmd.content.subarray(5, 16).toString(), 'DYD,000000#');
  assert.equal((await getV(vehicle)).cut, 0, 'pas « coupé » avant l\'accusé du boîtier');

  d.send(gt06.encodeCommandReply(cmd.content.readUInt32BE(1), 'DYD=Success!', d.next()));
  assert.ok(await eventually(async () => (await getV(vehicle)).cut === 1), 'coupé après accusé');
  assert.equal((await db.get('SELECT status FROM commands WHERE id = ?', [r.id])).status, 'confirmed');

  // le battement de coeur reflète l'état réel du boîtier (bit « huile coupée »)
  d.send(gt06.encodeStatus({ acc: false, cut: false }, d.next()));
  assert.ok(await eventually(async () => (await getV(vehicle)).cut === 0), 'l\'état réel du boîtier fait foi');
  d.close();
});

test('commande sans réponse : timeout ; commande en attente envoyée au login ; expiration', async () => {
  // boîtier hors ligne : la commande attend
  const r = await commands.request(await getV(vehicle2), 'restore', { id: null, name: 'test' }, 'user');
  assert.equal(r.status, 'pending');
  const again = await commands.request(await getV(vehicle2), 'restore', { id: null, name: 'test' }, 'user');
  assert.equal(again.id, r.id, 'pas de doublon');

  const d = new Device(port);
  d.send(gt06.encodeLogin('861234567890999', d.next()));
  await d.waitFor((f) => f.proto === PROTO.LOGIN);
  const cmd = await d.waitFor((f) => f.proto === PROTO.COMMAND);
  assert.ok(cmd, 'la commande en attente part au login');
  assert.equal(cmd.content.subarray(5, 5 + 12).toString(), 'HFYD,000000#');
  assert.equal(await eventually(async () => (await db.get('SELECT status FROM commands WHERE id = ?', [r.id])).status === 'timeout'), true, 'timeout sans réponse');
  d.close();

  await db.run("INSERT INTO commands (company_id, vehicle_id, user_id, command, status, t) VALUES (1, ?, NULL, 'cut', 'pending', ?)", [vehicle2, Date.now() - 3 * 3600000]);
  await commands.expire();
  assert.equal((await db.all("SELECT id FROM commands WHERE status = 'expired'")).length, 1);
});

test('fin', () => { server.close(); setTimeout(() => process.exit(0), 100).unref(); });
