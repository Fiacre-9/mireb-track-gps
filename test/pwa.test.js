// Vérifie que la PWA est servie correctement : service worker versionné, manifeste, icônes, fichiers précachés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 3400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}`;
let child;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-pwa-'));

test.before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_CLIENT: 'sqlite', SQLITE_FILE: path.join(tmp, 't.db'), JWT_SECRET: 'test-secret-test-secret-test-secret',
      COOKIE_SECURE: '0', SUPERADMIN_EMAIL: 'a@test.local', SUPERADMIN_PASSWORD: 'Passw0rd-test', DEMO: '0', SIMULATOR: '0', GT06_PORT: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('serveur non démarré')), 15000);
    child.stdout.on('data', (d) => { if (String(d).includes('TrackFleet :')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => reject(new Error('arrêt prématuré ' + c)));
  });
});
test.after(() => { if (child) child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('service worker : version injectée, jamais mis en cache', async () => {
  const r = await fetch(base + '/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  const js = await r.text();
  assert.ok(!js.includes('__BUILD__'), 'marqueur de version non remplacé');
  assert.match(js, /const BUILD = '[0-9a-f]{12}'/);
});

test('manifeste : type, mode plein écran, icônes présentes', async () => {
  const r = await fetch(base + '/manifest.webmanifest');
  assert.match(r.headers.get('content-type'), /application\/manifest\+json/);
  const m = await r.json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) { const x = await fetch(base + i.src); assert.equal(x.status, 200, i.src); assert.equal(x.headers.get('content-type'), 'image/png'); }
});

test('tous les fichiers précachés existent', async () => {
  const js = await (await fetch(base + '/sw.js')).text();
  const list = js.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.ok(list.length > 15);
  for (const u of list) { const x = await fetch(base + u); assert.equal(x.status, 200, u); }
});

test('pages : manifeste lié, CSP compatible, API jamais en cache', async () => {
  for (const p of ['/', '/login.html']) {
    const r = await fetch(base + p);
    const h = await r.text();
    assert.match(h, /rel="manifest"/, p);
    assert.match(h, /viewport-fit=cover/, p);
    assert.match(r.headers.get('content-security-policy'), /worker-src 'self'/);
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(h), 'script en ligne interdit par la CSP : ' + p);
  }
  const api = await fetch(base + '/api/auth/me');
  assert.equal(api.status, 401);
});
