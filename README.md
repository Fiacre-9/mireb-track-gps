# TrackFleet

Plateforme web de suivi GPS et de gestion de flotte : carte en temps réel, alertes, géoclôtures,
historique avec relecture, rapports, télécommande, entreprises multiples avec comptes par niveaux.
Node.js + Express + MySQL, interface en français et en anglais.

## Fonctions

| Domaine | Détail |
|---|---|
| Suivi | Carte temps réel (SSE), liste, recherche nom/plaque/IMEI, vitesse, carburant, température, contact |
| Alertes | Hors ligne, retour en ligne, contact coupé, excès de vitesse, carburant bas, entrée/sortie de zone, vitesse en zone, coupure |
| Géoclôtures | Zones circulaires, alerte entrée/sortie, limite de vitesse, coupure carburant automatique à la sortie |
| Historique | Trajets stockés en base, relecture animée (jour, hier, 7 jours) |
| Rapports | Kilométrage, vitesse moyenne et maximale, temps de conduite, trajets, alertes, impression |
| Télécommande | Coupure / rétablissement envoyés au boîtier, avec accusé et garde-fou de vitesse |
| Comptes | Super admin → entreprises (suspension possible) → administrateurs d'entreprise → lecteurs |
| Marque | Nom, couleur et logo par entreprise |
| Sécurité | Mots de passe bcrypt, cookie de session HttpOnly, protection CSRF, limiteur de connexion, CSP, isolation stricte par entreprise |

## Rôles

- **super_admin** : crée, suspend et réactive les entreprises ; consulte n'importe quelle entreprise via le sélecteur.
- **company_admin** : gère véhicules, zones, utilisateurs, marque et télécommande de son entreprise.
- **user** : lecture seule.

## Lancer en local (sans MySQL)

```bash
npm install
npm run dev        # SQLite intégré à Node 22+, simulateur de 8 véhicules, entreprise « Démo Transport »
```

Les identifiants du compte démo et du super admin s'affichent dans la console au premier démarrage.

## Déploiement : GitHub puis Hostinger

1. **GitHub** : `git remote add origin <url>` puis `git push -u origin main`. Le `.env` et `node_modules` sont ignorés.
2. **Hostinger (hPanel)** : créer une base MySQL (nom, utilisateur, mot de passe), puis une application Node.js
   (import depuis GitHub ou dépôt du zip), fichier de démarrage `server.js`.
3. **Variables d'environnement** (voir `.env.example`) : `NODE_ENV=production`, `DB_*`, `JWT_SECRET`,
   `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`. Laisser `DEMO=0` et `SIMULATOR=0`.
4. Lancer `npm install` puis démarrer. Les tables sont créées automatiquement au premier démarrage.
5. Connectez-vous avec le super admin, créez une entreprise, puis ajoutez ses véhicules.

## Brancher de vrais appareils

Onglet **Véhicules → Connexion** : l'application affiche l'URL et l'identifiant à saisir. Chaque véhicule a son propre jeton.

- **Sans aucun boîtier : un smartphone suffit** (idéal pour tester ou pour un premier véhicule). Installez l'application
  gratuite **Traccar Client** (Android/iOS), puis : *URL du serveur* = `https://votre-domaine/api/ingest/osmand/JETON`
  (l'onglet Véhicules → Connexion l'affiche), *Identifiant de l'appareil* = l'identifiant du véhicule, fréquence 10-30 s.
  Fonctionne sur l'hébergement Hostinger mutualisé, sans VPS.
- **Boîtiers 4G configurables en HTTP** : requête `GET/POST /api/ingest/osmand/JETON` (ou `/api/ingest/osmand?token=JETON`)
  avec `id`, `lat`, `lon`, et en option `speed` (nœuds, ou km/h avec `unit=kmh`), `bearing`, `timestamp`, `ignition`, `fuel`, `temp`.

## Boîtiers GPS GT06 (TCP) sur un VPS

Le serveur sait parler le protocole **GT06** (Concox et de nombreux clones) : login par IMEI, positions (0x12 / 0x22),
battement de coeur, alarmes (SOS, coupure d'alimentation, vibration, batterie faible, démontage) et commandes.
Il démarre quand `GT06_PORT` est défini (ex. `5023`).

1. **VPS** (Ubuntu/Debian) : installer Node 20+, cloner le dépôt dans `/opt/trackfleet`, `npm install`, créer `.env`
   (MySQL local ou distant, `JWT_SECRET`, `GT06_PORT=5023`), puis installer `deploy/trackfleet.service`.
2. **Pare-feu** : ouvrir le port TCP 5023 ; mettre Nginx + HTTPS devant le port web (3000).
3. **Véhicule** : onglet Véhicules → saisir l'**IMEI à 15 chiffres** du boîtier comme identifiant.
4. **Boîtier** : par SMS, pointer vers le serveur et régler l'APN de la carte SIM. Pour la plupart des GT06 :
   `APN,<apn>#` puis `SERVER,1,<domaine>,5023,0#` (ou `SERVER,0,<ip>,5023,0#`). Les commandes varient selon le modèle : vérifiez le manuel.
5. **Test sans matériel** : `node scripts/gt06-sim.js <hôte> 5023 <imei> 0` simule un boîtier (positions, battements, réponse aux coupures).

### Télécommande réelle

- Le bouton « Couper le carburant » met la commande en file ; elle part vers le boîtier connecté, et le véhicule n'est
  affiché « COUPÉ » qu'**après l'accusé du boîtier** (ou si son état réel le confirme au battement de coeur).
- **Sécurité** : une coupure demandée par un utilisateur est **refusée au-dessus de 20 km/h** (`CUT_MAX_SPEED`) ; une coupure
  automatique (sortie de géoclôture) est **différée jusqu'à l'arrêt du véhicule**. Une commande en attente expire après 1 h.
- Commandes par défaut : `DYD,000000#` (coupure) et `HFYD,000000#` (rétablissement), modifiables par variables d'environnement.

### Tests

`npm test` : 12 tests (décodeur, CRC vérifié sur les trames de la documentation GT06, serveur TCP avec faux boîtier, file de commandes).

## Limites actuelles

- **Pas de test sur matériel réel** : le décodeur est validé contre la documentation et un faux boîtier, pas contre un boîtier physique.
  Faites un premier essai avec un seul véhicule avant de déployer la flotte.
- **GT06 uniquement** (JT808 et autres protocoles : modules à ajouter). Le protocole GT06 n'a pas de mot de passe :
  l'IMEI sert d'identifiant, donc ne le divulguez pas et filtrez le port TCP si votre opérateur le permet.
- **Hébergement mutualisé Hostinger** : pas de TCP entrant, donc uniquement la réception HTTP (Traccar Client, boîtiers HTTP).
- **Vidéo en direct** : non incluse.
- **Géoclôtures** : cercles uniquement.
- Le chemin MySQL n'a pas pu être testé automatiquement ici (SQLite utilisé) : vérifier le premier démarrage sur la base vide.
