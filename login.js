const $ = (s) => document.querySelector(s);
applyI18n();
$('#lang').value = LANG;
$('#lang').onchange = (e) => setLang(e.target.value);

fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => { if (r.ok) location.href = '/'; });

$('#f').onsubmit = async (e) => {
  e.preventDefault();
  const err = $('#err');
  err.classList.add('hidden');
  const r = await fetch('/api/auth/login', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'x-tf': '1' },
    body: JSON.stringify({ email: $('#email').value, password: $('#pw').value })
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok) { if (d.user && d.user.lang) localStorage.setItem('tf_lang', d.user.lang); location.href = '/'; return; }
  err.textContent = d.error || 'Erreur';
  err.classList.remove('hidden');
};
