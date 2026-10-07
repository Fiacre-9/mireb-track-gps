// Simulateur de démonstration : fait circuler les véhicules « SIM… » en passant par le même moteur
// que les vraies positions (SIMULATOR=1). Ne jamais l'activer en production réelle.
const db = require('./db');
const engine = require('./engine');
const { distM } = require('./util');
const { CENTER } = require('./seed');

const TICK = 2000;
const state = new Map(); // vehicleId -> { target }
const rand = (a, b) => a + Math.random() * (b - a);
const newTarget = () => ({ lat: CENTER.lat + rand(-0.04, 0.04), lng: CENTER.lng + rand(-0.05, 0.05) });

async function tick() {
  const rows = await db.all("SELECT * FROM vehicles WHERE imei LIKE 'SIM%'");
  for (const v of rows) {
    if (v.imei === 'SIM1007') continue; // un véhicule volontairement silencieux (hors ligne)
    const s = state.get(v.id) || { target: newTarget() };
    state.set(v.id, s);
    if (v.cut) { await engine.processPosition(v, { lat: v.lat, lng: v.lng, speed: 0, acc: 0 }); continue; }
    const d = distM(v, s.target);
    if (d < 150) s.target = newTarget();
    const speed = Math.round((v.speed || 0) * 0.6 + (v.imei === 'SIM1004' ? rand(25, 55) : rand(20, 95)) * 0.4);
    const step = Math.min(((speed * 1000) / 3600) * (TICK / 1000), d);
    const k = d > 0 ? step / d : 0;
    await engine.processPosition(v, {
      lat: v.lat + (s.target.lat - v.lat) * k,
      lng: v.lng + (s.target.lng - v.lng) * k,
      speed, acc: 1,
      heading: (Math.atan2(s.target.lng - v.lng, s.target.lat - v.lat) * 180) / Math.PI,
      fuel: Math.max(0, (v.fuel ?? 60) - 0.01),
      temp: Math.round((v.temp ?? 30) + rand(-1, 1))
    });
  }
}
function start() {
  setInterval(() => tick().catch((e) => console.error('simulateur', e.message)), TICK).unref();
  console.log('[simulateur] actif (véhicules SIM…)');
}
module.exports = { start };
