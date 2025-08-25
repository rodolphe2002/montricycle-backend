# Tricycle Backend (Node.js + Express + MongoDB)

## Prérequis
- Node.js 18+
- MongoDB (instance locale ou Atlas)

## Installation
```bash
npm install
```

## Variables d’environnement (.env)
Créez un fichier `.env` dans `backend/` avec:
```
PORT=4000
MONGODB_URI=mongodb://localhost:27017/tricycle
NODE_ENV=development
```

## Démarrer en dev
```bash
npm run dev
```
L’API sera disponible sur `http://localhost:4000`.

## Endpoints
- `GET /api/health` — Statut API.
- `POST /api/auth/register` — Inscription client.
  - Body JSON: `{ "name": string, "phone": string, "password": string, "email?": string, "district?": string }`

## Notes
- Les mots de passe sont hashés avec `bcryptjs`.
- La validation est basique (à compléter selon besoin).
- Prochaine étape: `POST /api/auth/login` et JWT.
