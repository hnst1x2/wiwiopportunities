# Migration WiwiOpportunity → Hetzner (serveur ChatFlow)

Runbook pour héberger WiwiOpportunity sur le **même serveur Hetzner que ChatFlow**
(`chat.wiemibncheikh.com`), à côté de la stack existante, sans y toucher.

## Comment ça s'intègre (topologie cible)

Le serveur suit un modèle simple et on s'y aligne **à l'identique** :

| Élément | ChatFlow (existant) | WiwiOpportunity (nouveau) |
|---|---|---|
| Emplacement code | `/opt/chatflow` (user `deploy`) | `/opt/wiwiopportunity` (user `deploy`) |
| Déploiement | git pull + `docker compose … up -d --build` | idem |
| Projet Compose | isolé (`chatflow_default`) | isolé (`wiwiopportunity_default`) — **ne pas** rejoindre le réseau de ChatFlow |
| Exposition | `127.0.0.1:8080` / `:8081` (loopback) | `127.0.0.1:8082` (loopback) — 8082 est libre |
| Reverse proxy / TLS | **Caddy** au niveau hôte (`/etc/caddy/Caddyfile`), HTTPS auto | même bloc Caddy, HTTPS auto |
| Données persistantes | volumes Docker (Postgres/Redis) | volume Docker `wiwi-data` (base **SQLite**) |
| Sauvegardes | `/home/deploy/backups/` | idem (voir §7) |

Chaîne de requête : `navigateur → Caddy (443, TLS) → 127.0.0.1:8082 → conteneur Express`.

> **Règle stricte du serveur** : les conteneurs publient uniquement sur `127.0.0.1` (Docker
> contourne ufw). Seuls 22/80/443 sont publics. C'est déjà le cas dans `docker-compose.prod.yml`.

## Contraintes à connaître

- **RAM serrée** : ~3,7 Gio total, ~0,5 Gio libre (~2,7 Gio dispo avec cache). WiwiOpportunity
  est un seul petit process Express (~50–150 Mio) → OK. Le conteneur est plafonné à
  `mem_limit: 256m`. Ne pas co-localiser de base de données.
- **`deploy` n'a pas de sudo** : les étapes Caddy/ufw/systemctl (§4) doivent être faites par un
  **opérateur root**, pas par `deploy`.
- **Pas de disque data séparé** : la base SQLite vit sur le volume racine (25 Go libres — large).

## Décisions à acter avant de démarrer

1. **Domaine** — les artefacts utilisent `opportunities.wiemibncheikh.com` (cohérent avec `chat.`/`admin.`,
   même DNS, même e-mail ACME). Alternative « brandée » : `wiwiopportunity.com` (nécessite le
   domaine enregistré + DNS pointé). Le domaine n'apparaît qu'à **3 endroits** : `.env`
   (`PUBLIC_BASE_URL`), `deploy/Caddyfile.wiwiopportunity` (1re ligne), et le DNS.
2. **Qui exécute les étapes root** (édition + reload Caddy) — voir §4.

---

## Étape 0 — Préparer le repo (déjà fait, à committer)

Fichiers ajoutés/modifiés dans le repo pour rendre l'app déployable :

- `Dockerfile` — build reproductible (`npm ci --omit=dev`), `NODE_ENV=production`, `DATA_DIR=/data`, `--experimental-sqlite`, HEALTHCHECK.
- `.dockerignore` — contexte de build minimal (exclut `node_modules`, `.git`, le handoff, les docs, `.env`, `*.db*`).
- `docker-compose.prod.yml` — stack prod : build, `restart: always`, volume `wiwi-data`, bind `127.0.0.1:8082`, logs plafonnés, `mem_limit`.
- `.env.production.example` — gabarit des variables serveur.
- `deploy/Caddyfile.wiwiopportunity` — bloc vhost à coller dans `/etc/caddy/Caddyfile`.
- `server/db.js` — **couche SQLite** (module natif `node:sqlite`, **zéro dépendance**) : base à
  `DATA_DIR/wiwiopportunity.db` (WAL), schéma + **seed** au 1er démarrage depuis les JSON groupés.
  Formes de données identiques (tags tableau, featured booléen) → **vues / JS / API inchangés**.
- `server/app.js` — utilise `server/db.js` au lieu des fichiers JSON (défaut `DATA_DIR` = à côté du
  code → **comportement local inchangé**).
- `server/mailer.js` — email de confirmation à l'inscription newsletter via **Brevo SMTP** (nodemailer,
  même mécanique que ChatFlow). L'email est capturé en base même si l'envoi échoue ; si `SMTP_HOST`
  est vide, l'envoi est simplement ignoré (pas de crash).
- `scripts/import-json.js` — import (upsert) de données JSON existantes vers la base — pour récupérer
  les données live de Render (voir §8). `scripts/backup.js` — snapshot SQLite cohérent (voir §7).
- `package.json` — scripts lancés avec `--experimental-sqlite` (requis sur Node 22) ; `engines >=22.5`.
- `.gitignore` — ignore `.env` et les `*.db*` (base locale de dev).
- `package-lock.json` — committé (requis par `npm ci`).

Committer et pousser (le déploiement serveur fait un `git pull`) :

```bash
git add Dockerfile .dockerignore .gitignore docker-compose.prod.yml .env.production.example \
        deploy/ docs/ scripts/ server/app.js server/db.js server/mailer.js package.json package-lock.json
git commit -m "feat: SQLite storage + Hetzner deploy artifacts"
git push origin main
```

## Étape 1 — Récupérer le code sur le serveur *(user `deploy`)*

```bash
ssh deploy@chat.wiemibncheikh.com
sudo -v 2>/dev/null || true   # (deploy n'a pas sudo — normal)
git clone https://github.com/hnst1x2/wiwiopportunities.git /opt/wiwiopportunity
cd /opt/wiwiopportunity
```

> Si `/opt` n'est pas accessible en écriture à `deploy`, faire créer `/opt/wiwiopportunity`
> (chown `deploy:deploy`) par l'opérateur root, comme pour `/opt/chatflow`.

## Étape 2 — Configurer l'environnement *(user `deploy`)*

```bash
cp .env.production.example .env
chmod 600 .env
# Générer un secret de session :
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env   # puis retirer la ligne vide du gabarit
nano .env   # renseigner ADMIN_USER, ADMIN_PASSWORD (fort), PUBLIC_BASE_URL, SESSION_SECRET
```

`.env` final (mode 600) :

```
ADMIN_USER=…
ADMIN_PASSWORD=…            # PAS "changeme"
SESSION_SECRET=…            # openssl rand -hex 32
PUBLIC_BASE_URL=https://opportunities.wiemibncheikh.com
# Email Brevo (réutiliser le compte/creds de ChatFlow — domaine wiemibncheikh.com déjà SPF/DKIM) :
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=…                 # login SMTP Brevo de ChatFlow
SMTP_PASSWORD=…             # clé SMTP Brevo de ChatFlow
MAIL_FROM=WiwiOpportunity <contact@wiemibncheikh.com>
```

> Astuce : sur le serveur, plutôt que de retaper les creds, recopie les 5 lignes `SMTP_*` /
> `MAIL_FROM` depuis `/opt/chatflow/.env` (mêmes valeurs, sauf `MAIL_FROM` propre à Wiwi).

## Étape 3 — Lancer le conteneur *(user `deploy`)*

```bash
cd /opt/wiwiopportunity
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=30
# Sanity local (avant DNS/Caddy) :
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/         # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8082/api/opportunities   # 200
```

Au 1er démarrage, l'app crée `/data/wiwiopportunity.db` (SQLite/WAL) et le **seed** depuis les JSON
groupés dans l'image (volume `wiwiopportunity_wiwi-data`). Les écritures suivantes (newsletter,
admin) sont des transactions SQLite qui **survivent aux rebuilds et redémarrages**.

## Étape 4 — Vhost Caddy + HTTPS *(opérateur root — `deploy` ne peut pas)*

1. **DNS** : créer un enregistrement `A` pour l'hôte choisi → IP du serveur
   (si Cloudflare : DNS-only / nuage gris, sinon Caddy ne peut pas émettre le certificat).
2. Ajouter le bloc de `deploy/Caddyfile.wiwiopportunity` à la fin de `/etc/caddy/Caddyfile` :

   ```caddy
   opportunities.wiemibncheikh.com {
       tls contact@wiemibncheikh.com
       encode zstd gzip
       header Strict-Transport-Security "max-age=31536000; includeSubDomains"
       reverse_proxy 127.0.0.1:8082
   }
   ```
3. Valider et recharger (zéro coupure pour ChatFlow) :

   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

Caddy obtient le certificat automatiquement au 1er accès HTTPS.

## Étape 5 — Vérification

```bash
curl -sSI https://opportunities.wiemibncheikh.com/            | head -n1     # HTTP/2 200
curl -sS  https://opportunities.wiemibncheikh.com/api/opportunities | head -c 200
```

- Page d'accueil FR/EN OK, listing chargé, `/detail?id=…` OK.
- `/admin/login` → connexion avec `ADMIN_USER`/`ADMIN_PASSWORD`, une écriture (toggle « en avant »)
  persiste après `docker compose … up -d --build` (test volume).
- ChatFlow toujours debout (`docker ps`, `curl -sSI https://chat.wiemibncheikh.com | head -n1`).

## Étape 6 — Mises à jour (redéploiement)

```bash
cd /opt/wiwiopportunity
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f    # optionnel : nettoyer les anciennes images
```

Le volume `wiwi-data` n'est jamais recréé → les données restent.

## Étape 7 — Sauvegarde / restauration des données

La base est `/data/wiwiopportunity.db` (volume `wiwiopportunity_wiwi-data`). Aligné sur
`/home/deploy/backups/` (comme ChatFlow).

```bash
# Snapshot SQLite cohérent (VACUUM INTO — sans arrêter l'app, même en WAL), puis déplacer vers backups :
docker compose -f docker-compose.prod.yml exec -T app npm run backup -- /data/backup.db
docker run --rm -v wiwiopportunity_wiwi-data:/data -v /home/deploy/backups:/backup alpine \
  sh -c "mv /data/backup.db /backup/wiwi-$(date +%F-%H%M).db"

# Restauration :
docker compose -f docker-compose.prod.yml down
docker run --rm -v wiwiopportunity_wiwi-data:/data -v /home/deploy/backups:/backup alpine \
  sh -c 'cp /backup/<fichier>.db /data/wiwiopportunity.db && rm -f /data/wiwiopportunity.db-wal /data/wiwiopportunity.db-shm'
docker compose -f docker-compose.prod.yml up -d
```

> `VACUUM INTO` produit un `.db` propre et cohérent — pas besoin d'arrêter l'app pour sauvegarder.
> Ajouter cette sauvegarde à la routine pré-déploiement existante et/ou un cron quotidien.

## Étape 8 — Bascule DNS depuis Render & décommissionnement

1. Garder Render actif jusqu'à validation complète sur Hetzner.
2. Si le domaine public final est déplacé (ex. `wiwiopportunity.com`) : baisser le TTL DNS avant,
   pointer vers Hetzner, vérifier le certificat Caddy, puis suspendre le service Render.
3. Données vivantes de Render (inscriptions newsletter / éditions admin — **pas** dans le repo) :
   - **Avant le 1er déploiement** (base encore vide) : le plus simple — remplacer
     `server/opportunities.json` et `server/newsletter.json` du repo par les exports actuels de
     Render, committer, déployer → la base se seed directement avec les données live.
   - **Base déjà seedée** : importer en upsert (sans écraser les modifs admin) — copier les JSON
     dans le volume `/data`, puis :
     ```bash
     docker compose -f docker-compose.prod.yml exec -T app \
       npm run import -- /data/opportunities.json /data/newsletter.json
     ```

## Rollback

- Souci applicatif : `git checkout <commit-précédent> && docker compose -f docker-compose.prod.yml up -d --build`.
- Souci vhost : retirer le bloc du `Caddyfile`, `sudo systemctl reload caddy` (n'affecte pas ChatFlow).
- Le service Render reste le filet de sécurité tant qu'il n'est pas décommissionné.

---

## Durcissement recommandé (à valider — non appliqué)

À exposer l'admin sur Internet, durcir la session (cookie `Secure`/`HttpOnly` + `trust proxy`
car derrière Caddy). Diff proposé pour `server/app.js` :

```js
const isProd = process.env.NODE_ENV === 'production';
if (isProd) app.set('trust proxy', 1); // 1 seul hop : Caddy → app

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'wiwiopportunity-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,          // cookies uniquement en HTTPS en prod
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);
```

Optionnel — refuser de démarrer avec des secrets faibles en prod (log d'avertissement ou
`process.exit(1)`) :

```js
if (isProd && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme')) {
  console.warn('[WARN] ADMIN_PASSWORD non défini/défaut en production.');
}
if (isProd && !process.env.SESSION_SECRET) {
  console.warn('[WARN] SESSION_SECRET non défini en production.');
}
```

> Non appliqué par défaut pour ne pas modifier le comportement d'auth de l'app en ligne
> (Render) avant la bascule. À activer d'un commit dès que tu valides.
