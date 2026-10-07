// Moteur : reçoit une position, met à jour le véhicule, déclenche alertes et géoclôtures.
const db = require('./db');
const hub = require('./hub');
const { distM } = require('./util');

const OFFLINE_MS = (+process.env.OFFLINE_MINUTES || 5) * 60000;
const RETENTION_DAYS = +process.env.RETENTION_DAYS || 90;

const fenceCache = new Map();   // cid -> { t, list }
const insideState = new Map();  // vehicleId -> Set(fenceId)
const lastAlert = new Map();    // "vehicleId:type" -> t
const lastStored = new Map();   // vehicleId -> { lat, lng, t }
const lastPosT = new Map();     // vehicleId -> heure (boîtier) de la dernière position acceptée

async function getFences(cid) {
  const c = fenceCache.get(cid);
  if (c && Date.now() - c.t < 30000) return c.list;
  const list = await db.all('SELECT * FROM geofences WHERE company_id = ?', [cid]);
  fenceCache.set(cid, { t: Date.now(), list });
  return list;
}
const invalidateFences = (cid) => fenceCache.delete(cid);

// Version publique d'un véhicule (jamais le jeton d'ingestion)
function pub(v) {
  const { token, ...rest } = v;
  return rest;
}

async function addAlert(v, type, detail, force) {
  const key = `${v.id}:${type}`;
  const now = Date.now();
  if (!force && now - (lastAlert.get(key) || 0) < 60000) return;
  lastAlert.set(key, now);
  const r = await db.run(
    'INSERT INTO alerts (company_id, vehicle_id, type, detail, lat, lng, t) VALUES (?,?,?,?,?,?,?)',
    [v.company_id, v.id, type, String(detail || '').slice(0, 255), v.lat, v.lng, now]
  );
  hub.emit(v.company_id, 'alert', {
    id: r.insertId, vehicle_id: v.id, vehicle: v.name, plate: v.plate, type, detail, lat: v.lat, lng: v.lng, t: now
  });
}

async function processPosition(v, p) {
  const t = p.t || Date.now();
  const speed = Math.max(0, Math.round(p.speed || 0));

  // Position tamponnée par le boîtier et reçue en retard : on la garde dans l'historique sans toucher à l'état courant
  const lp = lastPosT.get(v.id);
  if (lp && t < lp - 1000) {
    await db.run('INSERT INTO positions (vehicle_id, lat, lng, speed, t) VALUES (?,?,?,?,?)', [v.id, p.lat, p.lng, speed, t]);
    return v;
  }
  lastPosT.set(v.id, t);

  const acc =p.acc === undefined || p.acc === null ? (speed > 0 ? 1 : v.acc) : (p.acc ? 1 : 0);
  const fuel = p.fuel ?? v.fuel;
  const temp = p.temp ?? v.temp;
  const heading = Math.round(p.heading ?? v.heading ?? 0);
  const staticSince = speed > 0 ? null : (v.static_since || t);

  const next = { ...v, lat: p.lat, lng: p.lng, speed, heading, acc, fuel, temp, online: 1, last_update: t, static_since: staticSince };
  await db.run(
    'UPDATE vehicles SET lat=?, lng=?, speed=?, heading=?, acc=?, fuel=?, temp=?, online=1, last_update=?, static_since=? WHERE id=?',
    [p.lat, p.lng, speed, heading, acc, fuel, temp, t, staticSince, v.id]
  );

  // Historique : on enregistre si déplacement > 10 m ou 30 s écoulées
  const ls = lastStored.get(v.id) || (v.lat != null ? { lat: v.lat, lng: v.lng, t: 0 } : null);
  if (!ls || distM(ls, p) > 10 || t - ls.t > 30000) {
    await db.run('INSERT INTO positions (vehicle_id, lat, lng, speed, t) VALUES (?,?,?,?,?)', [v.id, p.lat, p.lng, speed, t]);
    lastStored.set(v.id, { lat: p.lat, lng: p.lng, t });
  }

  // Alertes
  if (!v.online && v.last_update) await addAlert(next, 'online', 'Appareil de nouveau en ligne');
  if (v.acc && !acc) await addAlert(next, 'acc_off', 'Contact coupé');
  if (speed > v.speed_limit) await addAlert(next, 'overspeed', `${speed} km/h (limite ${v.speed_limit})`);
  if (fuel != null && fuel < 15) await addAlert(next, 'low_fuel', `Niveau de carburant ${Math.round(fuel)} %`);

  // Géoclôtures (état initial silencieux après un redémarrage)
  const fences = await getFences(v.company_id);
  const known = insideState.has(v.id);
  const set = insideState.get(v.id) || new Set();
  for (const g of fences) {
    const inside = distM(next, g) <= g.radius;
    const was = set.has(g.id);
    if (inside && !was) {
      set.add(g.id);
      if (known && g.on_enter) await addAlert(next, 'geofence_enter', `Entrée dans « ${g.name} »`, true);
    } else if (!inside && was) {
      set.delete(g.id);
      if (known && g.on_exit) await addAlert(next, 'geofence_exit', `Sortie de « ${g.name} »`, true);
      if (known && g.cut_on_exit && !next.cut) {
        // Passe par la file de commandes : envoi réel au boîtier, différé jusqu'à l'arrêt du véhicule
        const r = await require('./commands').request(next, 'cut', null, 'auto', `sortie de « ${g.name} »`);
        if (r.status === 'confirmed') next.cut = 1;
      }
    }
    if (inside && g.speed_limit && speed > g.speed_limit)
      await addAlert(next, 'geofence_speed', `${speed} km/h dans « ${g.name} » (limite ${g.speed_limit})`);
  }
  insideState.set(v.id, set);

  hub.emit(v.company_id, 'vehicle', pub(next));
  return next;
}

const ALARM_TEXT = {
  sos: 'Bouton SOS pressé', power_cut: 'Alimentation du boîtier coupée', vibration: 'Vibration anormale détectée',
  low_battery: 'Batterie faible', tamper: 'Boîtier démonté'
};

// Battement de coeur / état du boîtier (sans position) : en ligne, contact, état de coupure, alarmes
async function processStatus(v, s) {
  const t = Date.now();
  const acc = s.acc === undefined ? v.acc : (s.acc ? 1 : 0);
  const cut = s.cut === undefined ? v.cut : (s.cut ? 1 : 0);
  const speed = acc ? v.speed : 0;
  const next = { ...v, acc, cut, speed, online: 1, last_update: t };
  await db.run('UPDATE vehicles SET acc=?, cut=?, speed=?, online=1, last_update=? WHERE id=?', [acc, cut, speed, t, v.id]);

  if (!v.online && v.last_update) await addAlert(next, 'online', 'Appareil de nouveau en ligne');
  if (v.acc && !acc) await addAlert(next, 'acc_off', 'Contact coupé');
  if (v.cut !== cut) await addAlert(next, cut ? 'cut' : 'restore', 'Changement d\'état détecté sur le boîtier', true);
  if (s.alarm) await addAlert(next, s.alarm, ALARM_TEXT[s.alarm] || s.alarm);
  if (s.voltage !== undefined && s.voltage <= 2 && s.alarm !== 'low_battery') await addAlert(next, 'low_battery', `Batterie faible (niveau ${s.voltage}/6)`);

  hub.emit(v.company_id, 'vehicle', pub(next));
  return next;
}

// Détection des appareils hors ligne + purge de l'historique ancien
async function maintenance() {
  await require('./commands').expire();
  const stale = await db.all('SELECT * FROM vehicles WHERE online = 1 AND last_update < ?', [Date.now() - OFFLINE_MS]);
  for (const v of stale) {
    await db.run('UPDATE vehicles SET online=0, speed=0 WHERE id=?', [v.id]);
    const off = { ...v, online: 0, speed: 0 };
    await addAlert(off, 'offline', 'Appareil hors ligne', true);
    hub.emit(v.company_id, 'vehicle', pub(off));
  }
}
function startMaintenance() {
  setInterval(() => maintenance().catch((e) => console.error('maintenance', e.message)), 30000).unref();
  const purge = () => db.run('DELETE FROM positions WHERE t < ?', [Date.now() - RETENTION_DAYS * 86400000])
    .catch((e) => console.error('purge', e.message));
  setInterval(purge, 6 * 3600000).unref();
}

module.exports = { processPosition, processStatus, addAlert, invalidateFences, pub, startMaintenance };
