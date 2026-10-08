// PWA : enregistrement du service worker, installation sur l'écran d'accueil, état du réseau, mise à jour.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const TF = (window.TFPWA = { deferred: null, standalone: false, ios: false });

  TF.standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  TF.ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Chrome / Edge / Android : le navigateur propose l'installation, on garde l'invite pour notre propre bouton
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    TF.deferred = e;
    document.dispatchEvent(new Event('tf:installable'));
  });
  window.addEventListener('appinstalled', () => {
    TF.deferred = null; TF.standalone = true;
    document.dispatchEvent(new Event('tf:installed'));
  });
  TF.install = async function () {
    if (!TF.deferred) return false;
    TF.deferred.prompt();
    const choice = await TF.deferred.userChoice;
    TF.deferred = null;
    document.dispatchEvent(new Event('tf:installed'));
    return choice.outcome === 'accepted';
  };

  // Bandeau « pas de connexion »
  function net() { const bar = $('#netbar'); if (bar) bar.hidden = navigator.onLine; }
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  document.addEventListener('DOMContentLoaded', net);

  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      // Une nouvelle version est installée et attend : on propose de l'activer
      const offer = (worker) => {
        const bar = $('#updbar'); const btn = $('#updBtn');
        if (!bar || !btn) return;
        bar.hidden = false;
        btn.onclick = () => { btn.disabled = true; worker.postMessage({ type: 'SKIP_WAITING' }); };
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });

      // Après l'activation d'une nouvelle version, on recharge une seule fois (pas à la toute première installation)
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true; location.reload();
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (e) { console.warn('Service worker :', e.message); }
  });
})();
