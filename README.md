# agentivity_marketplace

REST API serving the Agentivity template catalog (`agentivity_marketplace_content`,
uploaded into Supabase Postgres). Consumed by Studio (web + desktop) for
browsing/downloading templates, and eventually by the public marketplace site.

No local file reads — this is the API layer over the Supabase `templates`
table created by `agentivity_marketplace_content/schema.sql`.

## API (v1)

All responses share one envelope:
- success: `{ data }` or `{ data, meta }` for lists
- error: `{ error: { code, message } }`

| Endpoint | Description |
|---|---|
| `GET /api/v1` | Discover available resources |
| `GET /api/v1/templates?q=&kind=&department=&limit=&offset=` | List templates (summary fields, no `content`) |
| `GET /api/v1/templates/{slug}` | Full template, including downloadable `content` |

`kind` is one of `agent`, `team`, `workflow`.

## Setup

```
npm install
cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

## Deploying

Standard Next.js app (no static export — API routes need a server), deploys
as-is on Vercel. Set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` as
environment variables in the Vercel project settings (never commit `.env`).
