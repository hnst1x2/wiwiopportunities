# WiwiOpportunity

Plateforme simple pour partager des opportunités (stages, bourses, études, volontariats, jobs) à l'international.

## Stack

- Node.js + Express
- EJS (templates)
- JSON comme stockage de base (`server/opportunities.json`, `server/newsletter.json`)
- Dockerfile + docker-compose pour tester rapidement

## Fonctionnalités principales

- Listing des opportunités avec :
  - recherche texte
  - filtres (pays, type, financement)
  - filtre tags/domaines
  - pagination front (9 cartes / page)
- Page détail d'une opportunité
- Mise en avant des réseaux sociaux
- Newsletter (enregistre les emails dans `server/newsletter.json`)
- Pages statiques : À propos, Contact

## Back-office

Accès via :

- `/admin/login` : connexion
- `/admin` : liste des opportunités
- `/admin/new` : création
- `/admin/edit/:id` : édition
- `/admin/delete/:id` : suppression

Identifiants admin (par défaut) :

- `ADMIN_USER=admin`
- `ADMIN_PASSWORD=changeme`

À override via variables d'environnement.

## Lancement sans Docker

```bash
npm install
npm start
# http://localhost:3000
```

## Lancement avec Docker

```bash
docker compose up --build -d
# http://localhost:3000
```

## Déploiement Render

- Utiliser le `Dockerfile`
- Configurer les variables d'environnement :
  - `ADMIN_USER`
  - `ADMIN_PASSWORD`
  - `SESSION_SECRET`
  - `PUBLIC_BASE_URL` (optionnel, pour les meta OG)
