// Traductions (FR par défaut, EN). Ajouter une langue = ajouter un bloc ici.
const I18N = {
  fr: {
    app: 'TrackFleet', login: 'Connexion', email: 'E-mail', password: 'Mot de passe', signin: 'Se connecter',
    logout: 'Déconnexion', monitor: 'Suivi', alerts: 'Alertes', zones: 'Géoclôtures', reports: 'Rapports',
    vehicles: 'Véhicules', users: 'Utilisateurs', companies: 'Entreprises', account: 'Mon compte',
    search: 'Nom / plaque / IMEI', moving: 'En mouvement', idle: 'À l\'arrêt', offline: 'Hors ligne', total: 'Total',
    speed: 'Vitesse', fuel: 'Carburant', temp: 'Température', ignition: 'Contact', today: 'Aujourd\'hui', state: 'État',
    online: 'En ligne', lastSignal: 'Dernier signal', history: 'Historique', cut: 'Couper le carburant', restore: 'Rétablir',
    normal: 'Normal', cutState: 'COUPÉ', confirmCut: 'Envoyer la commande de coupure à', all: 'Toutes les alertes',
    noAlerts: 'Aucune alerte pour le moment.', newZone: 'Nouvelle géoclôture', zoneHint: 'Cliquez sur la carte pour placer le centre.',
    name: 'Nom', radius: 'Rayon (m)', onEnter: 'Alerte à l\'entrée', onExit: 'Alerte à la sortie',
    cutOnExit: 'Coupure carburant à la sortie', zoneSpeed: 'Limite de vitesse (km/h)', optional: 'optionnel', save: 'Enregistrer',
    zonesList: 'Zones existantes', delete: 'Supprimer', edit: 'Modifier', cancel: 'Annuler', clickMapFirst: 'Cliquez d\'abord sur la carte.',
    mileage: 'Kilométrage', avgSpeed: 'Vitesse moyenne', maxSpeed: 'Vitesse maximale', driving: 'Temps de conduite', trips: 'Trajets',
    alertCount: 'Nombre d\'alertes', alertTypes: 'Types d\'alertes', day: 'Jour', week: '7 jours', month: '30 jours', print: 'Imprimer',
    plate: 'Plaque', imei: 'IMEI / identifiant', speedLimit: 'Limite vitesse', add: 'Ajouter', connect: 'Connexion',
    deviceHelp: 'Dans l\'application Traccar Client (ou le boîtier), URL du serveur :', deviceId: 'Identifiant de l\'appareil :',
    role: 'Rôle', roleAdmin: 'Administrateur', roleUser: 'Lecteur', active: 'Actif', status: 'Statut', suspended: 'Suspendue',
    activeCo: 'Active', suspend: 'Suspendre', activate: 'Réactiver', open: 'Ouvrir', createCompany: 'Nouvelle entreprise',
    adminName: 'Nom de l\'administrateur', adminEmail: 'E-mail de l\'administrateur', adminPassword: 'Mot de passe (8+ caractères)',
    pickCompany: 'Choisissez une entreprise dans la liste en haut, ou créez-en une.', company: 'Entreprise',
    brand: 'Marque personnalisée', brandName: 'Nom affiché', brandColor: 'Couleur', logoUrl: 'URL du logo (https)',
    changePw: 'Changer le mot de passe', currentPw: 'Mot de passe actuel', newPw: 'Nouveau mot de passe', language: 'Langue',
    saved: 'Enregistré', replay: 'Relecture', play: 'Lecture', noTrack: 'Pas assez de points sur cette période.',
    period: 'Période', yesterday: 'Hier', last7: '7 derniers jours', confirmDelete: 'Confirmer la suppression ?',
    password8: 'Mot de passe (8+ caractères)', keepPw: 'laisser vide pour ne pas changer', never: '—', copy: 'Copier', copied: 'Copié',
    a_offline: 'Hors ligne', a_online: 'De nouveau en ligne', a_acc_off: 'Contact coupé', a_overspeed: 'Excès de vitesse', a_low_fuel: 'Carburant bas',
    a_geofence_enter: 'Entrée dans une zone', a_geofence_exit: 'Sortie de zone', a_geofence_speed: 'Vitesse en zone',
    a_cut: 'Coupure carburant', a_restore: 'Rétablissement', km: 'km',
    a_sos: 'Bouton SOS', a_power_cut: 'Alimentation coupée', a_low_battery: 'Batterie faible', a_tamper: 'Boîtier démonté',
    lastCmd: 'Dernière commande', cmd_cut: 'Coupure', cmd_restore: 'Rétablissement',
    cmd_pending: 'en attente (envoi dès que possible)', cmd_sent: 'envoyée, attente de la réponse du boîtier', cmd_confirmed: 'confirmée par le boîtier',
    cmd_failed: 'refusée par le boîtier', cmd_timeout: 'sans réponse du boîtier', cmd_expired: 'expirée',
    menu: 'Menu', installApp: 'Installer l\'application', tagline: 'Suivi GPS de flotte en temps réel',
    iosHint: 'Sur iPhone : touchez Partager, puis « Sur l\'écran d\'accueil ».',
    offlineBar: 'Pas de connexion. Les données reviennent avec le réseau.', updateReady: 'Nouvelle version disponible', updateNow: 'Actualiser',
    noVehicles: 'Aucun véhicule pour le moment.', noMatch: 'Aucun véhicule ne correspond.', noZones: 'Aucune géoclôture.',
    loadError: 'Chargement impossible. Vérifiez la connexion.', retry: 'Réessayer', back: 'Retour', close: 'Fermer',
    showList: 'Afficher la liste des véhicules', liveLink: 'Liaison temps réel', circuit: 'Circuit carburant', pause: 'Pause'
  },
  en: {
    app: 'TrackFleet', login: 'Sign in', email: 'Email', password: 'Password', signin: 'Sign in',
    logout: 'Sign out', monitor: 'Monitor', alerts: 'Alerts', zones: 'Geofences', reports: 'Reports',
    vehicles: 'Vehicles', users: 'Users', companies: 'Companies', account: 'My account',
    search: 'Name / plate / IMEI', moving: 'Moving', idle: 'Idle', offline: 'Offline', total: 'Total',
    speed: 'Speed', fuel: 'Fuel', temp: 'Temperature', ignition: 'Ignition', today: 'Today', state: 'Status',
    online: 'Online', lastSignal: 'Last signal', history: 'History', cut: 'Cut fuel', restore: 'Restore',
    normal: 'Normal', cutState: 'CUT', confirmCut: 'Send the cut-off command to', all: 'All alerts',
    noAlerts: 'No alerts yet.', newZone: 'New geofence', zoneHint: 'Click the map to place the center.',
    name: 'Name', radius: 'Radius (m)', onEnter: 'Alert on entry', onExit: 'Alert on exit',
    cutOnExit: 'Cut fuel on exit', zoneSpeed: 'Speed limit (km/h)', optional: 'optional', save: 'Save',
    zonesList: 'Existing zones', delete: 'Delete', edit: 'Edit', cancel: 'Cancel', clickMapFirst: 'Click the map first.',
    mileage: 'Mileage', avgSpeed: 'Average speed', maxSpeed: 'Max speed', driving: 'Driving time', trips: 'Trips',
    alertCount: 'Alerts', alertTypes: 'Alert types', day: 'Day', week: '7 days', month: '30 days', print: 'Print',
    plate: 'Plate', imei: 'IMEI / identifier', speedLimit: 'Speed limit', add: 'Add', connect: 'Connection',
    deviceHelp: 'In the Traccar Client app (or the device), server URL:', deviceId: 'Device identifier:',
    role: 'Role', roleAdmin: 'Administrator', roleUser: 'Viewer', active: 'Active', status: 'Status', suspended: 'Suspended',
    activeCo: 'Active', suspend: 'Suspend', activate: 'Reactivate', open: 'Open', createCompany: 'New company',
    adminName: 'Administrator name', adminEmail: 'Administrator email', adminPassword: 'Password (8+ characters)',
    pickCompany: 'Pick a company from the list above, or create one.', company: 'Company',
    brand: 'Custom branding', brandName: 'Display name', brandColor: 'Color', logoUrl: 'Logo URL (https)',
    changePw: 'Change password', currentPw: 'Current password', newPw: 'New password', language: 'Language',
    saved: 'Saved', replay: 'Replay', play: 'Play', noTrack: 'Not enough points for this period.',
    period: 'Period', yesterday: 'Yesterday', last7: 'Last 7 days', confirmDelete: 'Confirm deletion?',
    password8: 'Password (8+ characters)', keepPw: 'leave empty to keep', never: '—', copy: 'Copy', copied: 'Copied',
    a_offline: 'Offline', a_online: 'Back online', a_acc_off: 'Ignition off', a_overspeed: 'Overspeed', a_low_fuel: 'Low fuel',
    a_geofence_enter: 'Zone entry', a_geofence_exit: 'Zone exit', a_geofence_speed: 'Speed in zone',
    a_cut: 'Fuel cut', a_restore: 'Restored', km: 'km',
    a_sos: 'SOS button', a_power_cut: 'Power cut', a_low_battery: 'Low battery', a_tamper: 'Device removed',
    lastCmd: 'Last command', cmd_cut: 'Cut', cmd_restore: 'Restore',
    cmd_pending: 'pending (sent as soon as possible)', cmd_sent: 'sent, waiting for the device reply', cmd_confirmed: 'confirmed by the device',
    cmd_failed: 'rejected by the device', cmd_timeout: 'no reply from the device', cmd_expired: 'expired',
    menu: 'Menu', installApp: 'Install the app', tagline: 'Real-time fleet GPS tracking',
    iosHint: 'On iPhone: tap Share, then "Add to Home Screen".',
    offlineBar: 'No connection. Data returns with the network.', updateReady: 'New version available', updateNow: 'Refresh',
    noVehicles: 'No vehicles yet.', noMatch: 'No vehicle matches.', noZones: 'No geofences.',
    loadError: 'Could not load. Check your connection.', retry: 'Retry', back: 'Back', close: 'Close',
    showList: 'Show vehicle list', liveLink: 'Live link', circuit: 'Fuel circuit', pause: 'Pause'
  }
};
let LANG = localStorage.getItem('tf_lang') || ((navigator.language || 'fr').startsWith('en') ? 'en' : 'fr');
const t = (k) => (I18N[LANG] && I18N[LANG][k]) || I18N.fr[k] || k;
function setLang(l) { LANG = I18N[l] ? l : 'fr'; localStorage.setItem('tf_lang', LANG); document.documentElement.lang = LANG; applyI18n(); }
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((e) => {
    e.placeholder = t(e.dataset.i18nPh);
    if (!e.hasAttribute('data-i18n-aria')) e.setAttribute('aria-label', e.placeholder);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((e) => { e.setAttribute('aria-label', t(e.dataset.i18nAria)); });
}
document.documentElement.lang = LANG;
