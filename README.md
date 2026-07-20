# GTM Ops — LeadGhost / Surfline

Single-user ops board: list-building pipeline, campaign progress (Instantly-synced + manual), and ODP launch pre-flight checklists. Next.js App Router, deployed on Vercel, state in Upstash Redis, Instantly API v2 for live campaign analytics and completion tracking.

## Architecture

```
Browser (page.tsx, client component)
  ├── GET/PUT /api/state            → Upstash Redis (whole board as one JSON blob)
  └── GET     /api/instantly/sync   → Instantly API v2 (server-side, key never leaves Vercel)
                                       GET https://api.instantly.ai/api/v2/campaigns/analytics
```

- **Lists** and **ODP Launches** are manual data stored in Redis.
- **Campaigns** merge two sources: read-only rows synced from Instantly (name, status, leads, contacted, sent, replies, opportunities — with `campaign_status = 3` rendered as ✓ COMPLETED), plus manual rows for Smartlead/HubSpot sends.
- You can tag each Instantly campaign with a client label; the mapping is stored in Redis keyed by `campaign_id` and survives syncs.
- Basic-auth middleware (`APP_USER` / `APP_PASS`) keeps the deployed board private.

## Local setup (Cursor)

1. Open this folder in Cursor.
2. `npm install`
3. Copy `.env.example` → `.env.local` and fill in:
   - `INSTANTLY_API_KEY` — Instantly → Settings → Integrations → API Keys (v2 key; API access requires a paid Instantly plan)
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — from Upstash (see below)
   - `APP_USER` / `APP_PASS` — anything you like
4. `npm run dev` → http://localhost:3000 (browser will prompt for the basic-auth credentials)

## Deploy to Vercel

1. Push this repo to GitHub (`git init && git add -A && git commit -m "init"`, create repo, push).
2. In Vercel: **Add New → Project**, import the repo. Framework auto-detects as Next.js.
3. **Storage tab → Marketplace → Upstash Redis** → create a database and connect it to the project. This injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` automatically. (If the integration injects `KV_REST_API_URL`/`KV_REST_API_TOKEN` names instead, either alias them in the Vercel env settings or update `lib/redis.ts` to read those names.)
4. **Settings → Environment Variables**: add `INSTANTLY_API_KEY`, `APP_USER`, `APP_PASS`, and optionally `WEBHOOK_SECRET` (for Instantly webhooks).
5. Deploy. Done.

## Instantly integration notes

- Analytics come from `GET /api/v2/campaigns/analytics` with `Authorization: Bearer <key>`.
- Responses are cached for 5 minutes (`next: { revalidate: 300 }`) — hit the ↻ sync button for a fresh pull after that window.
- Status code mapping lives in `lib/instantly.ts` (`STATUS_MAP`). `3 = Completed` drives the completion tracking. If Instantly changes field names, the defensive `num()` helper in that file is where to add variants.
- Field names in the analytics payload have varied across doc revisions; the client checks several known variants (`emails_sent_count` / `sent_count` / `total_sent`, etc.). If a metric shows `—` that Instantly's dashboard has, log `raw` from the sync response and add the actual field name to the `num()` call.
- **Webhooks** (Hyper Growth+): point Instantly at `POST /api/instantly/webhook?secret=<WEBHOOK_SECRET>`. Campaign status events (e.g. `campaign_completed`) are stored in Redis under `gtm-ops:instantly:events` and merged into `/api/instantly/sync` so completions show without waiting on the analytics cache. The webhook route is exempt from basic auth; auth is the shared secret only.

## Extending (good Cursor prompts)

- **Auto-create launches:** when a list hits the "Loaded" stage, auto-add an ODP launch with `qc` and `loaded` pre-checked.
- **Daily digest:** a Vercel Cron hitting `/api/instantly/sync` and emailing a summary of reply-rate movers.
- **Smartlead API:** mirror `lib/instantly.ts` for Smartlead so those campaigns sync too.

## Files

```
app/page.tsx                   — full dashboard UI (client)
app/api/state/route.ts         — board state GET/PUT
app/api/instantly/sync/route.ts— Instantly proxy (+ webhook status merge)
app/api/instantly/webhook/route.ts — Instantly campaign-status webhooks
lib/instantly.ts               — Instantly v2 client + status mapping
lib/redis.ts                   — Redis client + types
middleware.ts                  — basic auth (webhook exempt)
```
