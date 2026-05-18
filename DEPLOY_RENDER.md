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

**Production (`www.wow-pug.com`) runs on Render** (see response header `x-render-origin-server`). Pushing to GitHub does not update the site until Render finishes a deploy.

After any deploy, verify the running build:

```text
GET https://www.wow-pug.com/api/health
```

Expect `buildId` (e.g. `20260518-p2-event-mgmt-v1`) and `trackedRaids` including `Serpentshrine Cavern` and `Tempest Keep`. If those are missing, the live service is still on an old build — use **Manual Deploy** below.

### Manual deploy (when auto-deploy did not run)

1. [Render Dashboard](https://dashboard.render.com) → service **fallen-tacticians-api**
2. **Events** / **Deploys** → confirm the latest commit from `main` is listed
3. If there is no recent deploy or it failed: **Manual Deploy** → **Deploy latest commit**
4. Wait until status is **Live**, then re-check `/api/health` and Admin → Event Management

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
- `DISCORD_NEWS_WEBHOOK_URL` (secret, optional; enables Admin → News Notifications and automated Discord news posts)
- `DISCORD_BOT_TOKEN` (secret, optional; enables the Admin → News role dropdown, role pings, and Discord profile-post scanning, using `DISCORD_GUILD_ID` / `RAID_HELPER_SERVER_ID`)
- `DISCORD_PROFILE_INGEST_CHANNEL_ID` (optional; defaults to the current gear-check channel, set explicitly if the channel changes)
- `PUBLIC_BASE_URL` (your Render service URL, e.g. `https://fallen-tacticians-api.onrender.com`)

For **Admin → Discord Role Sync**, the same `DISCORD_BOT_TOKEN` is used. The bot needs
Discord's `Manage Roles` permission and its bot role must be higher than every role it
should assign: `DPS`, `Heal`, `Tank`, `PLB CORE`, `PLB Veteran`, `PLB Grunt`, and
`PLB Peon`. Create missing Discord roles before syncing; the website only assigns
existing roles and never removes roles.

### Persistent storage (Starter+)

The canonical user database lives in **one SQLite file**, `data/item-needs.sqlite`, on
the persistent disk. Everything else under `data/` is either a regenerable cache
(`data/cache/`) or a legacy JSON store kept around as a rollback source for the
canonical-user-DB cutover.

To keep the SQLite DB across deploys/restarts:

1. In Render service settings, add a **Persistent Disk** (Starter plan supports this).
2. Set the mount path (recommended: `/var/data`).
3. In environment variables, set:
   - `DATA_DIR=/var/data`

If you skip `DATA_DIR`, the app will still try to use `RENDER_DISK_MOUNT_PATH` automatically when present.

#### Canonical-user-DB feature flags

Each phase of the canonical-user-DB migration is gated by a per-feature env flag.
All default to `1` (materialised path on). Flip to `0` for one deploy if SQL drift
surfaces post-cutover; the legacy JSON / live-compute path is still reachable
because dual-write writers haven't been removed yet.

- `MATERIALIZE_IDENTITY` — Phase 2: name-resolution + profile-picture reads from `users` / `user_characters`.
- `MATERIALIZE_BADGES` — Phase 4: `/api/profile/me/badges` reads from `badge_state`.
- `MATERIALIZE_ATTENDANCE` — Phase 5/6: `/attendance`, `/death-leaderboard`, `/first-clear-participants`, `/boss-times` read from materialised tables.
- `MATERIALIZE_LOOT` — Phase 7: `/api/loot-history`, `/api/wcl/guild/:gid/loot-received`, and per-user loot endpoints read from `loot_awards`.
- `MATERIALIZE_PHASE3` — Phase 3: `mvp_votes` / `dm_subscribers` / `role_alert_log` / `hof_notes` in-memory state hydrates from SQLite at boot (legacy JSON write-through retained for rollback).
- `MATERIALIZE_RAID_APPEARANCES` — Phase 9: leaderboard "Events" KPI and 5/10/25/50/100 raid milestone badges read distinct WCL guild raid reports a user appeared in from `raid_appearances`. Scoped to the admin Event Management selection (`gargulLootState.selectedReportCodes`); when empty, falls back to "all known reports". When the table is empty (first deploy before any sync) the live Raid Helper signup count keeps serving so milestone badges don't drop to zero during transition.

#### Backup + snapshot operations

- `POST /api/admin/db/backup` — atomic SQLite point-in-time copy via `VACUUM INTO`. Files land in `data/backups/<timestamp>.sqlite`.
- `node scripts/snapshot-legacy-json.mjs` — copy every legacy per-user JSON store into `data/legacy-backups/<ISO>/` before any future deploy removes the dual-write wrappers.

#### Sync workers

The runner (`lib/sync/runner.mjs`) schedules five tasks at fixed intervals:

| Task          | Interval | Writes                                                                  |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `badges`      | 15 min   | `badge_state`                                                           |
| `attendance`  | 10 min   | `raid_attendance`, `raid_appearances`, `death_totals`, `first_clear_participants`, `best_time_roster` |
| `parses`      | 15 min   | `parse_summary`                                                         |
| `loot`        | 30 min   | `loot_awards`                                                           |

Inspect status at `GET /api/admin/sync` and trigger a single task with
`POST /api/admin/sync/:taskId` (admin auth).

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
