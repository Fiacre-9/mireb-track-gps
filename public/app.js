'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Toute donnée venant de la base est échappée avant d'entrer dans le HTML
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const PWA = window.TFPWA || {};
const state = { user: null, company: sessionStorage.getItem('tf_company'), vehicles: new Map(), selected: null, cmds: {}, unread: 0, es: null, tab: null, fences: [], filter: '' };
const ALERT_ICONS = { offline: '📡', online: '🟢', acc_off: '🔑', overspeed: '🚨', low_fuel: '⛽', geofence_enter: '📥', geofence_exit: '📤', geofence_speed: '🐢', cut: '✂️', restore: '🔌', sos: '🆘', power_cut: '🔋', low_battery: '🪫', tamper: '⚠️' };
const SECONDARY = ['zones', 'reports', 'vehicles', 'users', 'companies', 'account'];
const wide = window.matchMedia('(min-width: 900px)');
const locale = () => (LANG === 'fr' ? 'fr-FR' : 'en-GB');
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : t('never'));
const hasCompany = () => state.user.role !== 'super_admin' || !!state.company;
const isAdmin = () => ['super_admin', 'company_admin'].includes(state.user.role);

let toastTimer;
function toast(msg, bad, ms) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3500);
}
async function api(path, opts = {}) {
  const headers = { 'x-tf': '1' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (state.company && state.user && state.user.role === 'super_admin') headers['x-company'] = state.company;
  let r;
  try {
    r = await fetch('/api' + path, { method: opts.method || 'GET', headers, credentials: 'same-origin', body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw new Error(t('loadError')); }
  if (r.status === 401) { location.href = '/login.html'; throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erreur');
  return d;
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== '401') toast(e.message, true); } };
const hint = (k) => `<p class="hint">${esc(t(k))}</p>`;

function showBootErr(msg) { $('#bootMsg').textContent = msg || t('loadError'); $('#bootErr').hidden = false; }

// ================= Démarrage =================
let map, map2;
function mkMap(id) {
  const m = L.map(id, { attributionControl: false }).setView([-4.325, 15.322], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
  L.control.attribution({ position: 'topright', prefix: false }).addAttribution('© OpenStreetMap').addTo(m);
  return m;
}
async function boot() {
  applyI18n();
  let r;
  try { r = await fetch('/api/auth/me', { credentials: 'same-origin' }); } catch { return showBootErr(); }
  if (r.status === 401) { location.href = '/login.html'; return; }
  if (!r.ok) return showBootErr();
  state.user = (await r.json()).user;
  if (state.user.lang && state.user.lang !== LANG) setLang(state.user.lang);
  applyI18n();
  applyBrand();
  $$('[data-roles]').forEach((b) => { if (!b.dataset.roles.split(' ').includes(state.user.role)) b.classList.add('hidden'); });
  $('#brandForm').classList.toggle('hidden', state.user.role !== 'company_admin');
  if (state.user.role === 'company_admin') { $('#bName').value = state.user.brand_name || ''; $('#bColor').value = state.user.brand_color || '#2563eb'; $('#bLogo').value = state.user.logo_url || ''; }
  $('#zoneForm').classList.toggle('hidden', !isAdmin());
  $('#langSel').value = LANG;

  map = mkMap('map');
  map2 = mkMap('map2');
  map2.on('click', onZoneMapClick);

  if (state.user.role === 'super_admin') await loadCompanySelector();
  const asked = new URLSearchParams(location.search).get('tab');
  const ok = asked && LOADERS[asked] && asked !== 'menu' && !$(`.tab[data-tab="${asked}"]`).classList.contains('hidden');
  showTab(ok ? asked : (state.user.role === 'super_admin' && !state.company ? 'companies' : 'monitor'));
  if (hasCompany()) { await guard(loadVehicles)(); guard(loadFences)(); connectSSE(); }
}
function applyBrand() {
  const u = state.user;
  if (u.brand_color) {
    document.documentElement.style.setProperty('--blue', u.brand_color);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = u.brand_color;
  }
  const name = u.brand_name || u.company_name;
  if (name) { $('#brandName').textContent = name; document.title = name; }
  if (u.logo_url) { const l = $('#logo'); l.src = u.logo_url; l.classList.remove('hidden'); $('.brand .mark').classList.add('hidden'); }
}
async function loadCompanySelector() {
  const list = await api('/companies');
  const sel = $('#companySel');
  sel.classList.remove('hidden');
  sel.innerHTML = `<option value="">${esc(t('company'))}</option>` + list.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (state.company && !list.some((c) => String(c.id) === String(state.company))) { state.company = null; sessionStorage.removeItem('tf_company'); }
  sel.value = state.company || '';
  sel.onchange = () => setCompany(sel.value || null);
  return list;
}
function setCompany(id) {
  state.company = id; id ? sessionStorage.setItem('tf_company', id) : sessionStorage.removeItem('tf_company');
  $('#companySel').value = id || '';
  state.vehicles.clear(); state.selected = null; closeDetailUI();
  Object.values(markers).forEach((m) => m.remove()); for (const k in markers) delete markers[k];
  if (state.es) { state.es.close(); state.es = null; }
  if (id) { guard(loadVehicles)(); guard(loadFences)(); connectSSE(); } else renderList();
  showTab(state.tab === 'companies' && id ? 'monitor' : state.tab);
}

// ================= Onglets =================
const LOADERS = {
  monitor: () => renderList(), alerts: () => loadAlerts(), zones: () => loadFences(), reports: () => loadReport(),
  vehicles: () => loadVehicleTable(), users: () => loadUsers(), companies: () => loadCompanies(), account: () => {}, menu: () => {}
};
const NEEDS_COMPANY = ['monitor', 'alerts', 'zones', 'reports', 'vehicles', 'users'];
function showTab(name) {
  if (name === 'menu' && wide.matches) name = 'monitor';
  state.tab = name;
  document.body.dataset.tab = name;
  $$('.tab').forEach((b) => {
    const t0 = b.dataset.tab;
    b.classList.toggle('active', t0 === name || (t0 === 'menu' && SECONDARY.includes(name)));
    if (t0 === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
  $('#pageTitle').textContent = t(name);
  $('.pagehead .back').hidden = !SECONDARY.includes(name);
  if (name === 'alerts') { state.unread = 0; $('#badge').classList.add('hidden'); }
  setTimeout(() => { map && map.invalidateSize(); map2 && map2.invalidateSize(); }, 60);
  if (NEEDS_COMPANY.includes(name) && !hasCompany()) { showPickCompany(name); return; }
  guard(LOADERS[name])();
}
wide.addEventListener('change', () => { if (state.user) showTab(state.tab); });
function showPickCompany(name) {
  const h = hint('pickCompany');
  if (name === 'alerts') $('#alertList').innerHTML = h;
  if (name === 'reports') $('#repCards').innerHTML = h;
  if (name === 'vehicles') $('#vTable').innerHTML = h;
  if (name === 'users') $('#uTable').innerHTML = h;
  if (name === 'monitor') { $('#vlist').innerHTML = h; $('#stats').innerHTML = ''; }
  if (name === 'zones') $('#fenceList').innerHTML = h;
}

// ================= Suivi =================
const markers = {};
const status = (v) => (!v.online ? 'off' : v.speed > 0 ? 'moving' : 'idle');
function vIcon(v) {
  return L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<div class="vm ${status(v)}${v.cut ? ' cut' : ''}"><span style="transform:rotate(${Math.round(v.heading || 0)}deg)">▲</span></div>` });
}
async function loadVehicles() {
  const list = await api('/vehicles');
  state.vehicles = new Map(list.map((v) => [v.id, v]));
  list.forEach(upsertMarker);
  renderList();
  const pts = list.filter((v) => v.lat != null).map((v) => [v.lat, v.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}
function upsertMarker(v) {
  if (v.lat == null) return;
  if (!markers[v.id]) {
    markers[v.id] = L.marker([v.lat, v.lng], { icon: vIcon(v) }).addTo(map).on('click', () => select(v.id));
    markers[v.id].bindTooltip(v.plate || v.name);
  } else markers[v.id].setLatLng([v.lat, v.lng]).setIcon(vIcon(v));
}
const STATUS_LABEL = { moving: 'moving', idle: 'idle', off: 'offline' };
function renderList() {
  if (!hasCompany()) return showPickCompany('monitor');
  const all = [...state.vehicles.values()];
  const q = $('#search').value.toLowerCase();
  const f = state.filter;
  const list = all.filter((v) => (!f || status(v) === f) && `${v.name} ${v.plate} ${v.imei}`.toLowerCase().includes(q));
  const n = (s) => all.filter((v) => status(v) === s).length;
  const stat = (key, count, label) => `<button class="stat ${key}${f === key ? ' on' : ''}" data-act="filter" data-f="${key}" aria-pressed="${f === key}"><b>${count}</b><span>${esc(label)}</span></button>`;
  $('#stats').innerHTML = `<button class="stat all${f === '' ? ' on' : ''}" data-act="filter" data-f="" aria-pressed="${f === ''}"><b>${all.length}</b><span>${esc(t('total'))}</span></button>` +
    stat('moving', n('moving'), t('moving')) + stat('idle', n('idle'), t('idle')) + stat('off', n('off'), t('offline'));
  $('#vlist').innerHTML = !all.length ? hint('noVehicles') : !list.length ? hint('noMatch') : list.map((v) => {
    const s = status(v);
    return `<button class="vt ${s}${v.cut ? ' cut' : ''}${v.id === state.selected ? ' sel' : ''}" data-act="selectV" data-id="${v.id}">
      <span class="vt-name">${esc(v.name)}</span>
      <span class="vt-plate">${esc(v.plate) || '—'}</span>
      <span class="vt-speed">${v.online ? `<b>${v.speed}</b> km/h` : esc(t('offline'))}${v.fuel != null ? ` · ${Math.round(v.fuel)}%` : ''}</span>
      ${v.cut ? `<span class="vt-cut">${esc(t('cutState'))}</span>` : ''}</button>`;
  }).join('');
}
$('#search').oninput = renderList;

function connectSSE() {
  if (state.es) state.es.close();
  const es = new EventSource('/api/stream' + (state.user.role === 'super_admin' ? '?company=' + state.company : ''));
  state.es = es;
  es.onopen = () => { $('#conn').className = 'conn on'; };
  es.onerror = () => { $('#conn').className = 'conn off'; };
  es.addEventListener('vehicle', (e) => {
    const v = JSON.parse(e.data);
    state.vehicles.set(v.id, v); upsertMarker(v);
    if (state.tab === 'monitor') renderList();
    if (v.id === state.selected) renderDetailInfo();
  });
  es.addEventListener('command', (e) => {
    const c = JSON.parse(e.data);
    state.cmds[c.vehicle_id] = c;
    if (c.vehicle_id === state.selected) renderDetailInfo();
    if (['confirmed', 'failed', 'timeout'].includes(c.status)) toast(`${t('cmd_' + c.command)} : ${t('cmd_' + c.status)}`, c.status !== 'confirmed');
  });
  es.addEventListener('alert', () => {
    if (state.tab === 'alerts') guard(loadAlerts)();
    else { state.unread++; $('#badge').textContent = state.unread; $('#badge').classList.remove('hidden'); }
  });
}
// Le flux temps réel tombe quand le téléphone dort : on le rouvre au retour dans l'application
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.user || !hasCompany()) return;
  if (!state.es || state.es.readyState === 2) { connectSSE(); guard(loadVehicles)(); }
});

function closeDetailUI() {
  clearTrack();
  $('#detail').classList.add('hidden');
  $('#monitor').classList.remove('hasDetail');
}
function select(id, pan) {
  state.selected = id;
  const v = state.vehicles.get(id);
  clearTrack();
  const d = $('#detail');
  d.classList.remove('hidden');
  $('#monitor').classList.add('hasDetail');
  d.innerHTML = `<div class="dhead"><div><h2 id="dTitle"></h2><div class="dsub" id="dSub"></div></div>
      <button class="x" data-act="closeDetail" aria-label="${esc(t('close'))}">${ico('close')}</button></div>
    <div id="dInfo"></div>
    <div class="dactions">
      <select id="hRange" aria-label="${esc(t('period'))}"><option value="0">${esc(t('today'))}</option><option value="1">${esc(t('yesterday'))}</option><option value="7">${esc(t('last7'))}</option></select>
      <button class="btn" data-act="history">${ico('route')}${esc(t('history'))}</button>
    </div>
    <div id="dReplay" class="replay hidden"></div>`;
  renderDetailInfo();
  renderList();
  if (v && v.lat != null) {
    map.setView([v.lat, v.lng], Math.max(map.getZoom(), 15));
    // Sur téléphone la fiche couvre le bas de la carte : on remonte le véhicule dans la partie visible
    if (!wide.matches) map.panBy([0, Math.round(d.offsetHeight / 2)], { animate: false });
  }
  api(`/vehicles/${id}/commands`).then((l) => { if (l[0]) { state.cmds[id] = { vehicle_id: id, command: l[0].command, status: l[0].status }; if (state.selected === id) renderDetailInfo(); } }).catch(() => {});
}
function renderDetailInfo() {
  const v = state.vehicles.get(state.selected); if (!v || !$('#dInfo')) return;
  const s = status(v);
  $('#dTitle').textContent = v.name;
  $('#dSub').innerHTML = `<span>${esc(v.plate)}</span><span class="pill ${s === 'off' ? 'off' : s === 'idle' ? 'idle' : ''}">${esc(t(STATUS_LABEL[s]))}</span>`;
  const lc = state.cmds[v.id];
  const cmd = isAdmin() ? (v.cut ? `<button class="btn full" data-act="cmd" data-c="restore">${ico('power')}${esc(t('restore'))}</button>` : `<button class="btn danger full" data-act="cmd" data-c="cut">${ico('power')}${esc(t('cut'))}</button>`) : '';
  const tile = (label, val, cls = '') => `<div class="mt ${cls}"><small>${esc(label)}</small><b>${val}</b></div>`;
  $('#dInfo').innerHTML = `<div class="mgrid">
      ${tile(t('speed'), `${v.speed} km/h`, `big ${s}`)}
      ${tile(t('fuel'), v.fuel != null ? Math.round(v.fuel) + '%' : '—')}
      ${tile(t('temp'), v.temp != null ? Math.round(v.temp) + '°C' : '—')}
      ${tile(t('ignition'), v.acc ? 'ON' : 'OFF')}
      ${tile(t('circuit'), v.cut ? esc(t('cutState')) : esc(t('normal')), v.cut ? 'bad' : '')}
      ${tile(t('lastSignal'), esc(fmtTime(v.last_update)), 'wide')}
    </div>
    ${cmd ? `<div class="dactions">${cmd}</div>` : ''}
    ${lc ? `<p class="hint">${esc(t('lastCmd'))} : ${esc(t('cmd_' + lc.command))}, ${esc(t('cmd_' + lc.status))}</p>` : ''}`;
}

// ---- Historique + relecture ----
let trackLayer = null, replayDot = null, replayTimer = null, replayPts = [];
function clearTrack() {
  clearInterval(replayTimer); replayTimer = null;
  if (trackLayer) { trackLayer.remove(); trackLayer = null; }
  if (replayDot) { replayDot.remove(); replayDot = null; }
}
function dayRange(daysBack) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (daysBack === 1) return { from: d.getTime() - 86400000, to: d.getTime() - 1 };
  if (daysBack === 7) return { from: d.getTime() - 6 * 86400000, to: Date.now() };
  return { from: d.getTime(), to: Date.now() };
}
async function showHistory() {
  clearTrack();
  const { from, to } = dayRange(+$('#hRange').value);
  const r = await api(`/vehicles/${state.selected}/track?from=${from}&to=${to}`);
  replayPts = r.points;
  const box = $('#dReplay');
  if (replayPts.length < 2) { box.classList.add('hidden'); return toast(t('noTrack'), true); }
  const pts = replayPts.map((p) => [p.lat, p.lng]);
  trackLayer = L.polyline(pts, { color: '#16a34a', weight: 5 }).addTo(map);
  map.fitBounds(trackLayer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30, wide.matches ? 30 : $('#detail').offsetHeight + 20] });
  replayDot = L.circleMarker(pts[0], { radius: 8, color: '#2563eb', fillOpacity: 1 }).addTo(map);
  box.classList.remove('hidden');
  box.innerHTML = `<button class="btn sm" data-act="play">${ico('play')}${esc(t('play'))}</button><input type="range" id="rSlider" min="0" max="${pts.length - 1}" value="0" aria-label="${esc(t('replay'))}">
    <span id="rInfo">${r.totalKm} ${esc(t('km'))}</span>`;
  $('#rSlider').oninput = (e) => moveReplay(+e.target.value);
  moveReplay(0);
}
function moveReplay(i) {
  const p = replayPts[i]; if (!p || !replayDot) return;
  replayDot.setLatLng([p.lat, p.lng]);
  $('#rInfo').textContent = `${new Date(p.t).toLocaleTimeString(locale())}, ${p.speed} km/h`;
}
const playLabel = (btn, playing) => { btn.innerHTML = playing ? ico('pause') + esc(t('pause')) : ico('play') + esc(t('play')); };
function togglePlay(btn) {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; playLabel(btn, false); return; }
  const sl = $('#rSlider'); if (+sl.value >= +sl.max) sl.value = 0;
  playLabel(btn, true);
  const step = Math.max(1, Math.floor(replayPts.length / 200));
  replayTimer = setInterval(() => {
    sl.value = Math.min(+sl.max, +sl.value + step); moveReplay(+sl.value);
    if (+sl.value >= +sl.max) { clearInterval(replayTimer); replayTimer = null; playLabel(btn, false); }
  }, 70);
}

// ================= Alertes =================
const alertSel = $('#alertFilter');
function buildAlertFilter() {
  alertSel.innerHTML = `<option value="">${esc(t('all'))}</option>` + Object.keys(ALERT_ICONS).map((k) => `<option value="${k}">${ALERT_ICONS[k]} ${esc(t('a_' + k))}</option>`).join('');
}
alertSel.onchange = guard(() => loadAlerts());
async function loadAlerts() {
  if (!alertSel.options.length) buildAlertFilter();
  const list = await api('/alerts?type=' + encodeURIComponent(alertSel.value));
  $('#alertList').innerHTML = list.length ? list.map((a) => `<div class="card"><div class="ic">${ALERT_ICONS[a.type] || '⚠️'}</div>
    <div><div class="t">${esc(t('a_' + a.type))}</div><div class="s">${esc(a.vehicle)} ${esc(a.plate)}<br>${esc(a.detail)}</div></div>
    <div class="h">${fmtTime(a.t)}</div></div>`).join('') : hint('noAlerts');
}

// ================= Géoclôtures =================
let pending = null, pendingLayer = null, fenceLayers = [];
function onZoneMapClick(e) {
  if (!isAdmin() || !hasCompany()) return;
  pending = e.latlng;
  if (pendingLayer) pendingLayer.remove();
  pendingLayer = L.circle(e.latlng, { radius: +$('#gRadius').value || 200, color: '#f59e0b', dashArray: '6' }).addTo(map2);
}
async function loadFences() {
  const gs = await api('/geofences');
  state.fences = gs;
  fenceLayers.forEach((l) => l.remove()); fenceLayers = [];
  gs.forEach((g) => {
    const style = { radius: g.radius, color: '#2563eb', weight: 2, fillOpacity: 0.12 };
    fenceLayers.push(L.circle([g.lat, g.lng], style).addTo(map2).bindTooltip(g.name));
    fenceLayers.push(L.circle([g.lat, g.lng], style).addTo(map).bindTooltip(g.name));
  });
  $('#fenceList').innerHTML = gs.length ? gs.map((g) => `<div class="rec"><div class="rec-h"><b>${esc(g.name)}</b><span class="pill">${g.radius} m</span></div>
    ${isAdmin() ? `<div class="rec-a"><button class="btn danger sm" data-act="zDel" data-id="${g.id}">${esc(t('delete'))}</button></div>` : ''}</div>`).join('') : hint('noZones');
}
$('#gSave').onclick = guard(async () => {
  if (!pending) return toast(t('clickMapFirst'), true);
  await api('/geofences', { method: 'POST', body: { name: $('#gName').value, lat: pending.lat, lng: pending.lng, radius: +$('#gRadius').value,
    on_enter: $('#gEnter').checked, on_exit: $('#gExit').checked, cut_on_exit: $('#gCut').checked, speed_limit: $('#gSpeed').value || null } });
  if (pendingLayer) pendingLayer.remove(); pending = null; pendingLayer = null;
  toast(t('saved')); await loadFences();
});

// ================= Rapports =================
async function loadReport() {
  if (!$('#repVehicle').options.length || state.vehicles.size !== $('#repVehicle').options.length) {
    if (!state.vehicles.size) await loadVehicles();
    const cur = $('#repVehicle').value;
    $('#repVehicle').innerHTML = [...state.vehicles.values()].map((v) => `<option value="${v.id}">${esc(v.name)} (${esc(v.plate)})</option>`).join('');
    if (cur) $('#repVehicle').value = cur;
  }
  if (!$('#repVehicle').value) { $('#repCards').innerHTML = hint('noVehicles'); return; }
  const days = +$('#repPeriod').value;
  const to = Date.now(); let from;
  if (days === 1) { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime(); } else from = to - days * 86400000;
  const r = await api(`/vehicles/${$('#repVehicle').value}/report?from=${from}&to=${to}`);
  const k = (label, val) => `<div class="kpi"><small>${esc(label)}</small><div class="v">${esc(val)}</div></div>`;
  $('#repCards').innerHTML = k(t('mileage'), r.mileageKm + ' km') + k(t('avgSpeed'), r.avgSpeed + ' km/h') + k(t('maxSpeed'), r.maxSpeed + ' km/h') +
    k(t('driving'), r.drivingTime) + k(t('trips'), r.trips) + k(t('alertCount'), r.alertCount) + k(t('alertTypes'), r.alertTypes);
}
$('#repVehicle').onchange = guard(loadReport);
$('#repPeriod').onchange = guard(loadReport);
$('#repPrint').onclick = () => window.print();

// ================= Fiches (véhicules, utilisateurs, entreprises) =================
const rl = (label, val) => `<div class="rl"><span>${esc(label)}</span><span>${val}</span></div>`;
const rec = (title, pill, lines, actions) => `<div class="rec"><div class="rec-h"><b>${esc(title)}</b>${pill}</div>${lines}<div class="rec-a">${actions}</div></div>`;
const pillEl = (ok, label) => `<span class="pill ${ok ? '' : 'bad'}">${esc(label)}</span>`;
const btn = (act, id, label, cls = '', extra = '') => `<button class="btn sm ${cls}" data-act="${act}" data-id="${id}"${extra}>${esc(label)}</button>`;

async function loadVehicleTable() {
  const list = await api('/vehicles');
  state.vehicles = new Map(list.map((v) => [v.id, v]));
  $('#vTable').innerHTML = list.length ? list.map((v) => rec(v.name, pillEl(v.online, v.online ? t('online') : t('offline')),
    rl(t('plate'), esc(v.plate) || '—') + rl('IMEI', `<code>${esc(v.imei)}</code>`) + rl(t('speedLimit'), `${v.speed_limit} km/h`),
    btn('vConn', v.id, t('connect')) + btn('vEdit', v.id, t('edit')) + btn('vDel', v.id, t('delete'), 'danger'))).join('') : hint('noVehicles');
}
function resetVForm() { $('#vForm').reset(); $('#vId').value = ''; $('#vImei').disabled = false; $('#vCancel').classList.add('hidden'); }
$('#vCancel').onclick = resetVForm;
$('#vForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  const id = $('#vId').value;
  const body = { name: $('#vName').value, plate: $('#vPlate').value, speed_limit: $('#vLimit').value };
  if (id) await api('/vehicles/' + id, { method: 'PATCH', body });
  else await api('/vehicles', { method: 'POST', body: { ...body, imei: $('#vImei').value } });
  resetVForm(); toast(t('saved')); await loadVehicleTable();
});

let usersCache = [];
async function loadUsers() {
  usersCache = await api('/users');
  const roleLabel = (r) => (r === 'company_admin' ? t('roleAdmin') : t('roleUser'));
  $('#uTable').innerHTML = usersCache.map((u) => rec(u.name, pillEl(u.active, u.active ? t('active') : t('suspended')),
    rl('E-mail', esc(u.email)) + rl(t('role'), esc(roleLabel(u.role))),
    u.role === 'super_admin' ? '' : btn('uEdit', u.id, t('edit')) + btn('uToggle', u.id, u.active ? t('suspend') : t('activate')) + btn('uDel', u.id, t('delete'), 'danger'))).join('');
}
function resetUForm() { $('#uForm').reset(); $('#uId').value = ''; $('#uEmail').disabled = false; $('#uPw').placeholder = t('password8'); $('#uCancel').classList.add('hidden'); }
$('#uCancel').onclick = resetUForm;
$('#uForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  const id = $('#uId').value;
  const body = { name: $('#uName').value, role: $('#uRole').value };
  if (id) { if ($('#uPw').value) body.password = $('#uPw').value; await api('/users/' + id, { method: 'PATCH', body }); }
  else await api('/users', { method: 'POST', body: { ...body, email: $('#uEmail').value, password: $('#uPw').value } });
  resetUForm(); toast(t('saved')); await loadUsers();
});

async function loadCompanies() {
  const list = await loadCompanySelector();
  $('#cTable').innerHTML = list.map((c) => rec(c.name, pillEl(c.status === 'active', c.status === 'active' ? t('activeCo') : t('suspended')),
    rl(t('vehicles'), c.vehicles) + rl(t('users'), c.users),
    btn('cOpen', c.id, t('open')) + btn('cToggle', c.id, c.status === 'active' ? t('suspend') : t('activate'), c.status === 'active' ? 'danger' : '', ` data-s="${c.status === 'active' ? 'suspended' : 'active'}"`))).join('');
}
$('#cForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  await api('/companies', { method: 'POST', body: { name: $('#cName').value, adminName: $('#cAdmin').value, adminEmail: $('#cEmail').value, adminPassword: $('#cPw').value } });
  $('#cForm').reset(); toast(t('saved')); await loadCompanies();
});

// ================= Compte =================
$('#langSel').onchange = guard(async (e) => { setLang(e.target.value); await api('/auth/lang', { method: 'POST', body: { lang: e.target.value } }); buildAlertFilter(); showTab(state.tab); renderList(); });
$('#pwForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  await api('/auth/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } });
  $('#pwForm').reset(); toast(t('saved'));
});
$('#brandForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  await api('/brand', { method: 'PATCH', body: { brand_name: $('#bName').value, brand_color: $('#bColor').value, logo_url: $('#bLogo').value } });
  toast(t('saved')); setTimeout(() => location.reload(), 600);
});
$('#logout').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-tf': '1' }, credentials: 'same-origin' }).catch(() => {}); location.href = '/login.html'; };

// ================= Installation (écran d'accueil) =================
function installUI() {
  const can = !PWA.standalone && (!!PWA.deferred || PWA.ios);
  $$('[data-act="install"]').forEach((e) => { e.hidden = !can; });
}
installUI();
document.addEventListener('tf:installable', installUI);
document.addEventListener('tf:installed', installUI);

// ================= Actions déléguées =================
document.addEventListener('click', guard(async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = +b.dataset.id;
  switch (b.dataset.act) {
    case 'tab': showTab(b.dataset.tab); break;
    case 'toMenu': showTab('menu'); break;
    case 'reload': location.reload(); break;
    case 'install':
      if (PWA.deferred) await PWA.install(); else if (PWA.ios) toast(t('iosHint'), false, 8000);
      break;
    case 'sheet': { const s = $('#sheet'); const open = s.classList.toggle('open'); b.setAttribute('aria-expanded', String(open)); break; }
    case 'filter': state.filter = state.filter === b.dataset.f ? '' : b.dataset.f; renderList(); break;
    case 'selectV': select(id, true); break;
    case 'closeDetail': state.selected = null; closeDetailUI(); renderList(); break;
    case 'history': await showHistory(); break;
    case 'play': togglePlay(b); break;
    case 'cmd': {
      const v = state.vehicles.get(state.selected);
      if (b.dataset.c === 'cut' && !confirm(`${t('confirmCut')} ${v.name} ?`)) return;
      const r = await api(`/vehicles/${v.id}/command`, { method: 'POST', body: { command: b.dataset.c } });
      state.cmds[v.id] = { vehicle_id: v.id, command: b.dataset.c, status: r.status }; renderDetailInfo();
      break;
    }
    case 'zDel': if (confirm(t('confirmDelete'))) { await api('/geofences/' + id, { method: 'DELETE' }); await loadFences(); } break;
    case 'vEdit': {
      const v = state.vehicles.get(id);
      $('#vId').value = v.id; $('#vName').value = v.name; $('#vPlate').value = v.plate; $('#vImei').value = v.imei; $('#vImei').disabled = true;
      $('#vLimit').value = v.speed_limit; $('#vCancel').classList.remove('hidden'); $('#vName').focus(); $('#vName').scrollIntoView({ block: 'center' }); break;
    }
    case 'vDel': if (confirm(t('confirmDelete'))) { await api('/vehicles/' + id, { method: 'DELETE' }); await loadVehicleTable(); } break;
    case 'vConn': {
      const v = await api('/vehicles/' + id);
      const url = `${location.origin}/api/ingest/osmand/${v.token}`;
      const box = $('#devInfo'); box.classList.remove('hidden');
      box.innerHTML = `<p>${esc(t('deviceHelp'))}<br><code>${esc(url)}</code></p><p><button class="btn sm" data-act="copy" data-text="${esc(url)}">${esc(t('copy'))}</button></p>
        <p>${esc(t('deviceId'))} <code>${esc(v.imei)}</code></p>`;
      box.scrollIntoView({ block: 'nearest' });
      break;
    }
    case 'copy': await navigator.clipboard.writeText(b.dataset.text); toast(t('copied')); break;
    case 'uEdit': {
      const u = usersCache.find((x) => x.id === id);
      $('#uId').value = u.id; $('#uName').value = u.name; $('#uEmail').value = u.email; $('#uEmail').disabled = true;
      $('#uRole').value = u.role; $('#uPw').placeholder = t('keepPw'); $('#uCancel').classList.remove('hidden'); $('#uName').focus(); break;
    }
    case 'uToggle': { const u = usersCache.find((x) => x.id === id); await api('/users/' + id, { method: 'PATCH', body: { active: !u.active } }); await loadUsers(); break; }
    case 'uDel': if (confirm(t('confirmDelete'))) { await api('/users/' + id, { method: 'DELETE' }); await loadUsers(); } break;
    case 'cOpen': setCompany(String(id)); break;
    case 'cToggle': await api('/companies/' + id, { method: 'PATCH', body: { status: b.dataset.s } }); await loadCompanies(); break;
  }
}));

boot().catch((e) => { console.error(e); showBootErr(); });
