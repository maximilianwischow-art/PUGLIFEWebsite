# Deploy to DigitalOcean with `www.wow-pug.com`

This app can run on **DigitalOcean App Platform** (recommended for easiest HTTPS + GitHub deploys).

## 1) Prep your repo

- Push latest code to GitHub (including `server.js`, `public/`, and `.do/app.yaml`).
- After pushing, open **Apps → your app → Activity** and confirm the latest deploy succeeded (Event Management needs the running `server.js`, not just static files).
- In `.do/app.yaml`, replace:
  - `YOUR_GITHUB_USERNAME`
  - `YOUR_REPO_NAME`

## 2) Create the app

1. In DigitalOcean: **Create -> Apps**
2. Choose GitHub repo + `main` branch
3. App Platform should detect Node app automatically
4. Optional: import `.do/app.yaml` settings (or set manually in UI)

## 3) Configure environment variables

Set these in App Platform:

- `NODE_ENV=production`
- `PORT=8080`
- `WCL_CLIENT_ID` (secret)
- `WCL_CLIENT_SECRET` (secret)
- `WCL_ALLOWED_GAME_ZONES`
- `RAID_HELPER_API_KEY` (secret)
- `RAID_HELPER_SERVER_ID=711838953430319115`
- `RAID_HELPER_DEFAULT_EVENT_ID` (optional)
- `DISCORD_NEWS_WEBHOOK_URL` (secret, optional; enables Admin → News Notifications and automated Discord news posts)
- `DISCORD_BOT_TOKEN` (secret, optional; enables the Admin → News role dropdown, role pings, and Discord profile-post scanning, using `RAID_HELPER_SERVER_ID` / `DISCORD_GUILD_ID`)
- `DISCORD_PROFILE_INGEST_CHANNEL_ID` (optional; defaults to the current gear-check channel, set explicitly if the channel changes)

For **Admin → Discord Role Sync**, the same `DISCORD_BOT_TOKEN` is used. The bot needs
Discord's `Manage Roles` permission and its bot role must be higher than every role it
should assign: `DPS`, `Heal`, `Tank`, `PLB CORE`, `PLB Veteran`, `PLB Grunt`, and
`PLB Peon`. Create missing Discord roles before syncing; the website only assigns
existing roles and never removes roles.

## 4) Add your custom domain

In your app:

1. **Settings -> Domains**
2. Add:
   - `www.wow-pug.com`
   - (optional) `wow-pug.com`
3. DigitalOcean will show required DNS records.

## 5) DNS records at your domain registrar

Use exactly what DO shows. Typical setup:

- `www` -> **CNAME** -> `your-app-name.ondigitalocean.app`
- root (`@`) -> either:
  - **ALIAS/ANAME** to `your-app-name.ondigitalocean.app` (if supported), or
  - Redirect `wow-pug.com` -> `https://www.wow-pug.com`

## 6) SSL and go-live check

- Wait for DNS propagation (usually minutes, sometimes up to 24h).
- DigitalOcean provisions HTTPS certificate automatically.
- Verify:
  - `https://www.wow-pug.com/api/health`
  - `https://www.wow-pug.com/`
  - `https://www.wow-pug.com/events.html`

## 7) Recommended post-deploy

- Enable deploy-on-push in App Platform.
- Add uptime monitor for `/api/health`.
- Keep secrets only in DO env vars (never commit `.env`).
