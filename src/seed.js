// Premier démarrage : super admin + (optionnel) entreprise de démonstration.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const { newToken } = require('./util');

const CENTER = { lat: -4.325, lng: 15.322 }; // Kinshasa
const hash = (pw) => bcrypt.hashSync(pw, 11);

async function seed() {
  const any = await db.get('SELECT id FROM users LIMIT 1');
  if (!any) {
    const email = process.env.SUPERADMIN_EMAIL || 'admin@trackfleet.local';
    let pw = process.env.SUPERADMIN_PASSWORD;
    const generated = !pw;
    if (generated) pw = crypto.randomBytes(9).toString('base64url');
    await db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)',
      [null, 'Super admin', email.toLowerCase(), hash(pw), 'super_admin', Date.now()]);
    console.log(`[seed] Super admin créé : ${email}${generated ? ' / mot de passe : ' + pw + '  (à noter, affiché une seule fois)' : ''}`);
  }

  if (process.env.DEMO === '1' && !(await db.get("SELECT id FROM companies WHERE name = 'Démo Transport'"))) {
    const c = await db.run('INSERT INTO companies (name, status, created_at) VALUES (?,?,?)', ['Démo Transport', 'active', Date.now()]);
    const pw = process.env.DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');
    await db.run('INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)',
      [c.insertId, 'Admin Démo', 'demo@trackfleet.local', hash(pw), 'company_admin', Date.now()]);
    console.log(`[seed] Compte démo : demo@trackfleet.local / ${pw}`);
    const names = ['Camion citerne 01', 'Camion citerne 02', 'Pick-up Station A', 'Pick-up Station B', 'Moto livraison 1', 'Camion benne 03', 'Fourgon logistique', 'Berline direction'];
    const plates = ['KIN-1001', 'KIN-1002', 'KIN-2210', 'KIN-2211', 'KIN-3050', 'KIN-4107', 'KIN-5500', 'KIN-0001'];
    for (let i = 0; i < names.length; i++) {
      await db.run(
        'INSERT INTO vehicles (company_id, name, plate, imei, token, speed_limit, lat, lng, fuel, temp, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [c.insertId, names[i], plates[i], `SIM${1000 + i}`, newToken(), 80,
          CENTER.lat + (Math.random() - 0.5) * 0.06, CENTER.lng + (Math.random() - 0.5) * 0.08,
          40 + Math.random() * 55, 28 + Math.random() * 10, Date.now()]);
    }
    await db.run('INSERT INTO geofences (company_id, name, lat, lng, radius, on_enter, on_exit, cut_on_exit, speed_limit) VALUES (?,?,?,?,?,?,?,?,?)',
      [c.insertId, 'Dépôt central', CENTER.lat - 0.01, CENTER.lng + 0.01, 800, 1, 1, 0, null]);
    await db.run('INSERT INTO geofences (company_id, name, lat, lng, radius, on_enter, on_exit, cut_on_exit, speed_limit) VALUES (?,?,?,?,?,?,?,?,?)',
      [c.insertId, 'Station 1', CENTER.lat + 0.02, CENTER.lng - 0.02, 400, 1, 1, 0, 30]);
  }
}
module.exports = { seed, CENTER };
