# Deploy on Render

This project is ready to deploy as a single Node.js web service (API + frontend files from `public/`).

## 1) Push to GitHub

If this folder is not in Git yet:

```bash
git init
git add .
git commit -m "Prepare deployment"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

If it already exists as a repo, just push your latest changes.

## 2) Create Render service

1. Open [https://render.com](https://render.com)
2. New -> Blueprint
3. Select your GitHub repo
4. Render will detect `render.yaml` and create `fallen-tacticians-api`

## 3) Set environment variables in Render

In Render dashboard -> service -> Environment, set:

- `WCL_CLIENT_ID`
- `WCL_CLIENT_SECRET`
- `WCL_ALLOWED_GAME_ZONES`  
  Example:
  `Karazhan,Gruul's Lair,Magtheridon's Lair,Serpentshrine Cavern,Tempest Keep,Hyjal Summit,Black Temple,Sunwell Plateau,Zul'Aman`
- `RAID_HELPER_API_KEY`
- `RAID_HELPER_SERVER_ID`
- `RAID_HELPER_DEFAULT_EVENT_ID` (optional)

Notes:
- `PORT` is handled by Render automatically; do not hardcode your local port in production logic.
- Do **not** upload your local `.env` file.

## 4) Verify deployment

After deploy completes, open:

- `/api/health` -> should return `{ "ok": true, ... }`
- `/` -> main dashboard
- `/events.html` -> future events page

## 5) Ongoing updates

Push to `main` and Render auto-deploys (enabled in `render.yaml`).
