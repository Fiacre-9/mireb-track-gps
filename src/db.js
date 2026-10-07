// Couche base de données : MySQL en production (Hostinger), SQLite (intégré à Node 22+) pour les tests locaux.
// Toutes les requêtes utilisent des paramètres « ? » et un SQL portable entre les deux.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const client = (process.env.DB_CLIENT || 'mysql').toLowerCase();
let impl;

if (client === 'sqlite') {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'trackfleet.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  impl = {
    async all(sql, p = []) { return db.prepare(sql).all(...norm(p)).map((r) => ({ ...r })); },
    async run(sql, p = []) {
      const r = db.prepare(sql).run(...norm(p));
      return { insertId: Number(r.lastInsertRowid), affected: Number(r.changes) };
    },
    async exec(sql) { db.exec(sql); }
  };
} else {
  const mysql = require('mysql2/promise');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false
  });
  impl = {
    async all(sql, p = []) { const [rows] = await pool.query(sql, p); return rows; },
    async run(sql, p = []) { const [r] = await pool.query(sql, p); return { insertId: r.insertId, affected: r.affectedRows }; },
    async exec(sql) { await pool.query(sql); }
  };
}

async function get(sql, p) { return (await impl.all(sql, p))[0] || null; }

async function migrate() {
  const file = path.join(__dirname, '..', 'db', `schema.${client === 'sqlite' ? 'sqlite' : 'mysql'}.sql`);
  const statements = fs.readFileSync(file, 'utf8').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await impl.exec(s);
}

module.exports = { all: impl.all, run: impl.run, get, migrate, client };
