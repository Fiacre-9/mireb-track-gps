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
| Télécommande | Coupure / rétablissement (voir « Limites ») |
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

- **Application Traccar Client** (Android/iOS) : URL du serveur `https://votre-domaine/api/ingest/osmand?token=JETON`,
  identifiant de l'appareil = IMEI/identifiant du véhicule.
- **Boîtiers 4G configurables en HTTP** : requête `GET/POST /api/ingest/osmand` avec `id`, `token`, `lat`, `lon`,
  et en option `speed` (nœuds, ou km/h avec `unit=kmh`), `bearing`, `timestamp`, `ignition`, `fuel`, `temp`.

## Limites actuelles (à traiter dans les prochaines étapes)

- **Boîtiers GPS classiques (GT06, JT808, etc.)** : ils parlent en TCP, ce qui n'est pas possible sur l'hébergement
  Node.js mutualisé d'Hostinger. Il faut un VPS et un décodeur de protocole (module à ajouter).
- **Télécommande** : la commande est enregistrée et l'état « coupé » est mémorisé ; l'envoi réel au boîtier dépend
  de son protocole (même module TCP). Avec le simulateur, la coupure est appliquée immédiatement.
- **Vidéo en direct** : non incluse.
- **Géoclôtures** : cercles uniquement (polygones à venir).
- Le test automatisé du chemin MySQL n'a pas pu être fait dans l'environnement de développement (SQLite utilisé) :
  vérifier le premier démarrage sur Hostinger avec la base vide.
