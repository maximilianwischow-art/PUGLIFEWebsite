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
- `RAID_HELPER_SERVER_ID` **or** `DISCORD_GUILD_ID` (same Discord server id — either works)
- `RAID_HELPER_DEFAULT_EVENT_ID` (optional)
- `AUTH_SESSION_SECRET` (required in production)
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` (if voting login is enabled)
- `PUBLIC_BASE_URL` (your Render service URL, e.g. `https://fallen-tacticians-api.onrender.com`)

### Persistent voting/P2 storage (Starter+)

To keep `mvp-votes.json` and `p2-materials.json` across deploys/restarts:

1. In Render service settings, add a **Persistent Disk** (Starter plan supports this).
2. Set the mount path (recommended: `/var/data`).
3. In environment variables, set:
   - `DATA_DIR=/var/data`

If you skip `DATA_DIR`, the app will still try to use `RENDER_DISK_MOUNT_PATH` automatically when present.

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
