'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Toute donnée venant de la base est échappée avant d'entrer dans le HTML
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { user: null, company: sessionStorage.getItem('tf_company'), vehicles: new Map(), selected: null, cmds: {}, unread: 0, es: null, tab: null, fences: [] };
const ALERT_ICONS = { offline: '📡', online: '🟢', acc_off: '🔑', overspeed: '🚨', low_fuel: '⛽', geofence_enter: '📥', geofence_exit: '📤', geofence_speed: '🐢', cut: '✂️', restore: '🔌', sos: '🆘', power_cut: '🔋', low_battery: '🪫', tamper: '⚠️' };
const locale = () => (LANG === 'fr' ? 'fr-FR' : 'en-GB');
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString(locale()) : t('never'));
const hasCompany = () => state.user.role !== 'super_admin' || !!state.company;
const isAdmin = () => ['super_admin', 'company_admin'].includes(state.user.role);

let toastTimer;
function toast(msg, bad) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}
async function api(path, opts = {}) {
  const headers = { 'x-tf': '1' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (state.company && state.user && state.user.role === 'super_admin') headers['x-company'] = state.company;
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers, credentials: 'same-origin', body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erreur');
  return d;
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== '401') toast(e.message, true); } };

// ================= Démarrage =================
let map, map2;
async function boot() {
  const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!r.ok) { location.href = '/login.html'; return; }
  state.user = (await r.json()).user;
  if (state.user.lang && state.user.lang !== LANG) setLang(state.user.lang);
  applyI18n();
  applyBrand();
  $$('.tab').forEach((b) => { if (b.dataset.roles && !b.dataset.roles.split(' ').includes(state.user.role)) b.classList.add('hidden'); });
  $('#brandForm').classList.toggle('hidden', state.user.role !== 'company_admin');
  if (state.user.role === 'company_admin') { $('#bName').value = state.user.brand_name || ''; $('#bColor').value = state.user.brand_color || '#2563eb'; $('#bLogo').value = state.user.logo_url || ''; }
  $('#zoneForm').classList.toggle('hidden', !isAdmin());
  $('#langSel').value = LANG;

  const tiles = () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  map = L.map('map').setView([-4.325, 15.322], 12); tiles().addTo(map);
  map2 = L.map('map2').setView([-4.325, 15.322], 12); tiles().addTo(map2);
  map2.on('click', onZoneMapClick);

  if (state.user.role === 'super_admin') await loadCompanySelector();
  $$('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(state.user.role === 'super_admin' && !state.company ? 'companies' : 'monitor');
  if (hasCompany()) { await guard(loadVehicles)(); guard(loadFences)(); connectSSE(); }
}
function applyBrand() {
  const u = state.user;
  if (u.brand_color) document.documentElement.style.setProperty('--blue', u.brand_color);
  const name = u.brand_name || u.company_name;
  if (name) { $('#brandName').textContent = name; document.title = name; }
  if (u.logo_url) { const l = $('#logo'); l.src = u.logo_url; l.classList.remove('hidden'); }
}
async function loadCompanySelector() {
  const list = await api('/companies');
  const sel = $('#companySel');
  sel.classList.remove('hidden');
  sel.innerHTML = `<option value="">— ${esc(t('company'))} —</option>` + list.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (state.company && !list.some((c) => String(c.id) === String(state.company))) { state.company = null; sessionStorage.removeItem('tf_company'); }
  sel.value = state.company || '';
  sel.onchange = () => setCompany(sel.value || null);
  return list;
}
function setCompany(id) {
  state.company = id; id ? sessionStorage.setItem('tf_company', id) : sessionStorage.removeItem('tf_company');
  $('#companySel').value = id || '';
  state.vehicles.clear(); state.selected = null; $('#detail').classList.add('hidden');
  Object.values(markers).forEach((m) => m.remove()); for (const k in markers) delete markers[k];
  if (state.es) { state.es.close(); state.es = null; }
  if (id) { guard(loadVehicles)(); guard(loadFences)(); connectSSE(); } else renderList();
  showTab(state.tab === 'companies' && id ? 'monitor' : state.tab);
}

// ================= Onglets =================
const LOADERS = {
  monitor: () => renderList(), alerts: () => loadAlerts(), zones: () => loadFences(), reports: () => loadReport(),
  vehicles: () => loadVehicleTable(), users: () => loadUsers(), companies: () => loadCompanies(), account: () => {}
};
const NEEDS_COMPANY = ['monitor', 'alerts', 'zones', 'reports', 'vehicles', 'users'];
function showTab(name) {
  state.tab = name;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === name));
  if (name === 'alerts') { state.unread = 0; $('#badge').classList.add('hidden'); }
  setTimeout(() => { map && map.invalidateSize(); map2 && map2.invalidateSize(); }, 50);
  if (NEEDS_COMPANY.includes(name) && !hasCompany()) { showPickCompany(name); return; }
  guard(LOADERS[name])();
}
function showPickCompany(name) {
  const hint = `<p class="hint">${esc(t('pickCompany'))}</p>`;
  if (name === 'alerts') $('#alertList').innerHTML = hint;
  if (name === 'reports') $('#repCards').innerHTML = hint;
  if (name === 'vehicles') $('#vTable').innerHTML = hint;
  if (name === 'users') $('#uTable').innerHTML = hint;
  if (name === 'monitor') $('#vlist').innerHTML = hint;
  if (name === 'zones') $('#fenceList').innerHTML = hint;
}

// ================= Suivi =================
const markers = {};
const status = (v) => (!v.online ? 'off' : v.speed > 0 ? 'moving' : 'idle');
function vIcon(v) {
  return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
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
function renderList() {
  if (!hasCompany()) return showPickCompany('monitor');
  const all = [...state.vehicles.values()];
  const q = $('#search').value.toLowerCase();
  const list = all.filter((v) => `${v.name} ${v.plate} ${v.imei}`.toLowerCase().includes(q));
  const n = (s) => all.filter((v) => status(v) === s).length;
  $('#stats').innerHTML = `<span title="${esc(t('moving'))}">🟢 ${n('moving')}</span><span title="${esc(t('idle'))}">🟠 ${n('idle')}</span><span title="${esc(t('offline'))}">⚪ ${n('off')}</span><span>${esc(t('total'))} ${all.length}</span>`;
  $('#vlist').innerHTML = list.map((v) => `<li data-act="selectV" data-id="${v.id}" class="${v.id === state.selected ? 'sel' : ''}">
    <div class="n"><span class="dot ${status(v)}"></span>${esc(v.name)}</div>
    <div class="m">${esc(v.plate)} · ${v.online ? v.speed + ' km/h' : esc(t('offline'))}${v.fuel != null ? ' · ⛽ ' + Math.round(v.fuel) + '%' : ''}</div></li>`).join('');
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

function select(id, pan) {
  state.selected = id;
  const v = state.vehicles.get(id);
  if (pan && v && v.lat != null) map.setView([v.lat, v.lng], 15);
  clearTrack();
  const d = $('#detail');
  d.classList.remove('hidden');
  d.innerHTML = `<h4><span id="dTitle"></span><button class="x" data-act="closeDetail" aria-label="close">×</button></h4>
    <div id="dInfo"></div>
    <div class="actions">
      <select id="hRange"><option value="0">${esc(t('today'))}</option><option value="1">${esc(t('yesterday'))}</option><option value="7">${esc(t('last7'))}</option></select>
      <button class="act" data-act="history">🗺️ ${esc(t('history'))}</button>
    </div>
    <div id="dReplay" class="replay hidden"></div>`;
  renderDetailInfo();
  renderList();
  api(`/vehicles/${id}/commands`).then((l) => { if (l[0]) { state.cmds[id] = { vehicle_id: id, command: l[0].command, status: l[0].status }; if (state.selected === id) renderDetailInfo(); } }).catch(() => {});
}
function renderDetailInfo() {
  const v = state.vehicles.get(state.selected); if (!v || !$('#dInfo')) return;
  $('#dTitle').textContent = `${v.name}${v.plate ? ' · ' + v.plate : ''}`;
  const lc = state.cmds[v.id];
  const cmd = isAdmin() ? (v.cut ? `<button class="act" data-act="cmd" data-c="restore">🔌 ${esc(t('restore'))}</button>` : `<button class="act danger" data-act="cmd" data-c="cut">✂️ ${esc(t('cut'))}</button>`) : '';
  $('#dInfo').innerHTML = `<div class="grid"><div><b>${v.speed} km/h</b>${esc(t('speed'))}</div><div><b>${v.fuel != null ? Math.round(v.fuel) + '%' : '—'}</b>${esc(t('fuel'))}</div>
    <div><b>${v.temp != null ? Math.round(v.temp) + '°C' : '—'}</b>${esc(t('temp'))}</div><div><b>${v.acc ? 'ON' : 'OFF'}</b>${esc(t('ignition'))}</div></div>
    <div class="grid"><div><b>${v.online ? esc(t('online')) : esc(t('offline'))}</b>${esc(t('state'))}</div><div><b>${v.cut ? esc(t('cutState')) : esc(t('normal'))}</b>${esc(t('fuel'))}</div>
    <div><b>${fmtTime(v.last_update)}</b>${esc(t('lastSignal'))}</div><div>${cmd}</div></div>${lc ? `<p class="hint">${esc(t('lastCmd'))} : ${esc(t('cmd_' + lc.command))} — ${esc(t('cmd_' + lc.status))}</p>` : ''}`;
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
  map.fitBounds(trackLayer.getBounds(), { padding: [40, 40] });
  replayDot = L.circleMarker(pts[0], { radius: 8, color: '#2563eb', fillOpacity: 1 }).addTo(map);
  box.classList.remove('hidden');
  box.innerHTML = `<button class="act" data-act="play">▶ ${esc(t('play'))}</button><input type="range" id="rSlider" min="0" max="${pts.length - 1}" value="0">
    <span id="rInfo">${r.totalKm} ${esc(t('km'))}</span>`;
  $('#rSlider').oninput = (e) => moveReplay(+e.target.value);
  moveReplay(0);
}
function moveReplay(i) {
  const p = replayPts[i]; if (!p || !replayDot) return;
  replayDot.setLatLng([p.lat, p.lng]);
  $('#rInfo').textContent = `${new Date(p.t).toLocaleTimeString(locale())} · ${p.speed} km/h`;
}
function togglePlay(btn) {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; btn.textContent = `▶ ${t('play')}`; return; }
  const sl = $('#rSlider'); if (+sl.value >= +sl.max) sl.value = 0;
  btn.textContent = '⏸';
  const step = Math.max(1, Math.floor(replayPts.length / 200));
  replayTimer = setInterval(() => {
    sl.value = Math.min(+sl.max, +sl.value + step); moveReplay(+sl.value);
    if (+sl.value >= +sl.max) { clearInterval(replayTimer); replayTimer = null; btn.textContent = `▶ ${t('play')}`; }
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
    <div><div class="t">${esc(t('a_' + a.type))} · ${esc(a.vehicle)}</div><div class="s">${esc(a.plate)} — ${esc(a.detail)}</div></div>
    <div class="h">${fmtTime(a.t)}</div></div>`).join('') : `<p class="hint">${esc(t('noAlerts'))}</p>`;
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
    fenceLayers.push(L.circle([g.lat, g.lng], { radius: g.radius, color: '#2563eb', weight: 2, fillOpacity: 0.12 }).addTo(map2).bindTooltip(g.name));
    fenceLayers.push(L.circle([g.lat, g.lng], { radius: g.radius, color: '#2563eb', weight: 2, fillOpacity: 0.12 }).addTo(map).bindTooltip(g.name));
  });
  $('#fenceList').innerHTML = gs.map((g) => `<li><span>🛡️ ${esc(g.name)} (${g.radius} m)</span>${isAdmin() ? `<button class="act danger" data-act="zDel" data-id="${g.id}">${esc(t('delete'))}</button>` : ''}</li>`).join('');
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
  if (!$('#repVehicle').value) { $('#repCards').innerHTML = ''; return; }
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

// ================= Véhicules (admin) =================
async function loadVehicleTable() {
  const list = await api('/vehicles');
  state.vehicles = new Map(list.map((v) => [v.id, v]));
  $('#vTable').innerHTML = `<table><thead><tr><th>${esc(t('name'))}</th><th>${esc(t('plate'))}</th><th>IMEI</th><th>${esc(t('speedLimit'))}</th><th>${esc(t('state'))}</th><th></th></tr></thead><tbody>` +
    list.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.plate)}</td><td><code>${esc(v.imei)}</code></td><td>${v.speed_limit} km/h</td>
      <td><span class="pill ${v.online ? '' : 'bad'}">${esc(v.online ? t('online') : t('offline'))}</span></td>
      <td><button class="act" data-act="vConn" data-id="${v.id}">${esc(t('connect'))}</button><button class="act" data-act="vEdit" data-id="${v.id}">${esc(t('edit'))}</button>
      <button class="act danger" data-act="vDel" data-id="${v.id}">${esc(t('delete'))}</button></td></tr>`).join('') + '</tbody></table>';
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

// ================= Utilisateurs =================
let usersCache = [];
async function loadUsers() {
  usersCache = await api('/users');
  const roleLabel = (r) => (r === 'company_admin' ? t('roleAdmin') : t('roleUser'));
  $('#uTable').innerHTML = `<table><thead><tr><th>${esc(t('name'))}</th><th>E-mail</th><th>${esc(t('role'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>` +
    usersCache.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(roleLabel(u.role))}</td>
      <td><span class="pill ${u.active ? '' : 'bad'}">${esc(u.active ? t('active') : '—')}</span></td>
      <td>${u.role === 'super_admin' ? '' : `<button class="act" data-act="uEdit" data-id="${u.id}">${esc(t('edit'))}</button>
      <button class="act" data-act="uToggle" data-id="${u.id}">${esc(u.active ? t('suspend') : t('activate'))}</button>
      <button class="act danger" data-act="uDel" data-id="${u.id}">${esc(t('delete'))}</button>`}</td></tr>`).join('') + '</tbody></table>';
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

// ================= Entreprises (super admin) =================
async function loadCompanies() {
  const list = await loadCompanySelector();
  $('#cTable').innerHTML = `<table><thead><tr><th>${esc(t('company'))}</th><th>${esc(t('vehicles'))}</th><th>${esc(t('users'))}</th><th>${esc(t('status'))}</th><th></th></tr></thead><tbody>` +
    list.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.vehicles}</td><td>${c.users}</td>
      <td><span class="pill ${c.status === 'active' ? '' : 'bad'}">${esc(c.status === 'active' ? t('activeCo') : t('suspended'))}</span></td>
      <td><button class="act" data-act="cOpen" data-id="${c.id}">${esc(t('open'))}</button>
      <button class="act ${c.status === 'active' ? 'danger' : ''}" data-act="cToggle" data-id="${c.id}" data-s="${c.status === 'active' ? 'suspended' : 'active'}">${esc(c.status === 'active' ? t('suspend') : t('activate'))}</button></td></tr>`).join('') + '</tbody></table>';
}
$('#cForm').onsubmit = guard(async (e) => {
  e.preventDefault();
  await api('/companies', { method: 'POST', body: { name: $('#cName').value, adminName: $('#cAdmin').value, adminEmail: $('#cEmail').value, adminPassword: $('#cPw').value } });
  $('#cForm').reset(); toast(t('saved')); await loadCompanies();
});

// ================= Compte =================
$('#langSel').onchange = guard(async (e) => { setLang(e.target.value); await api('/auth/lang', { method: 'POST', body: { lang: e.target.value } }); buildAlertFilter(); showTab(state.tab); });
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
$('#logout').onclick = async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-tf': '1' }, credentials: 'same-origin' }); location.href = '/login.html'; };

// ================= Actions déléguées =================
document.addEventListener('click', guard(async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = +b.dataset.id;
  switch (b.dataset.act) {
    case 'selectV': select(id, true); break;
    case 'closeDetail': state.selected = null; clearTrack(); $('#detail').classList.add('hidden'); renderList(); break;
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
      $('#vLimit').value = v.speed_limit; $('#vCancel').classList.remove('hidden'); $('#vName').focus(); break;
    }
    case 'vDel': if (confirm(t('confirmDelete'))) { await api('/vehicles/' + id, { method: 'DELETE' }); await loadVehicleTable(); } break;
    case 'vConn': {
      const v = await api('/vehicles/' + id);
      const url = `${location.origin}/api/ingest/osmand?token=${v.token}`;
      const box = $('#devInfo'); box.classList.remove('hidden');
      box.innerHTML = `<p>${esc(t('deviceHelp'))}<br><code>${esc(url)}</code> <button class="act" data-act="copy" data-text="${esc(url)}">${esc(t('copy'))}</button></p>
        <p>${esc(t('deviceId'))} <code>${esc(v.imei)}</code></p>`;
      break;
    }
    case 'copy': await navigator.clipboard.writeText(b.dataset.text); toast(t('copied')); break;
    case 'uEdit': {
      const u = usersCache.find((x) => x.id === id);
      $('#uId').value = u.id; $('#uName').value = u.name; $('#uEmail').value = u.email; $('#uEmail').disabled = true;
      $('#uRole').value = u.role; $('#uPw').placeholder = t('keepPw'); $('#uCancel').classList.remove('hidden'); break;
    }
    case 'uToggle': { const u = usersCache.find((x) => x.id === id); await api('/users/' + id, { method: 'PATCH', body: { active: !u.active } }); await loadUsers(); break; }
    case 'uDel': if (confirm(t('confirmDelete'))) { await api('/users/' + id, { method: 'DELETE' }); await loadUsers(); } break;
    case 'cOpen': setCompany(String(id)); break;
    case 'cToggle': await api('/companies/' + id, { method: 'PATCH', body: { status: b.dataset.s } }); await loadCompanies(); break;
  }
}));

boot().catch((e) => console.error(e));
