const $ = (s) => document.querySelector(s);
applyI18n();
$('#lang').value = LANG;
$('#lang').onchange = (e) => setLang(e.target.value);

// Déjà connecté : direction l'application (sans bloquer la page si le réseau est coupé)
fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => { if (r.ok) location.href = '/'; }).catch(() => {});

// Bouton « Installer l'application »
const PWA = window.TFPWA || {};
function installUI() {
  const can = !PWA.standalone && (!!PWA.deferred || PWA.ios);
  $('#installBtn').hidden = !can;
}
installUI();
document.addEventListener('tf:installable', installUI);
document.addEventListener('tf:installed', installUI);
$('#installBtn').onclick = async () => {
  if (PWA.deferred) await PWA.install();
  else if (PWA.ios) { const e = $('#err'); e.textContent = t('iosHint'); e.classList.remove('hidden'); }
};

$('#f').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#err'); const go = $('#go');
  err.classList.add('hidden');
  go.disabled = true;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-tf': '1' },
      body: JSON.stringify({ email: $('#email').value, password: $('#pw').value })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { if (d.user && d.user.lang) localStorage.setItem('tf_lang', d.user.lang); location.href = '/'; return; }
    err.textContent = d.error || t('loadError');
  } catch { err.textContent = t('loadError'); }
  err.classList.remove('hidden');
  go.disabled = false;
};
