# agentivity_marketplace

Read-only REST API of the Agentivity marketplace: the **Templates**. A Template is one use case in one file (the main team or
workflow, everything it calls, seed rows, a cover picture), made in the Studio and published from `agentivity_marketplace_content`
into Supabase. Consumed by the Studio and by the public site (Synergi).

The format and this contract are described in `agentivity_service/.. /delivery/features/templates/template-format.md` (sections 2
and 10). There is no write endpoint: the founder publishes with a script (`agentivity_marketplace_content/scripts/publish.mjs`).

## API (v1)

Public, no authentication, CORS `*` (GET and OPTIONS). Every answer shares one envelope, except the file download:
- success: `{ data }`, or `{ data, meta }` for a list
- error: `{ error: { code, message } }`

| Endpoint | Description |
|---|---|
| `GET /api/v1` | Discover the resources |
| `GET /api/v1/templates?q=&tag=&language=&author=&limit=&offset=` | List the Templates as summaries (no content). `q` searches name, tagline, description and tags (the start of each word); `tag` can be repeated or comma separated, **all** must match; `language` is `en zh hi es fr ar pt ru de ja`; `author` is an author id; `limit` 1 to 100 (default 24); sorted by name. `meta` is `{ total, limit, offset }`. |
| `GET /api/v1/templates/{id}` | One summary, plus `contents` (kind, id, name, role, depth of every entity; no bodies) and `requires`. |
| `GET /api/v1/templates/{id}/file` | **The download**: the Template file itself (not wrapped), `application/vnd.agentivity.template+json`, `Content-Disposition: attachment; filename="{id}.template.json"`. The cover is `cover.imageUrl` (a URL), never a `dataUri`. The Studio's importer reads it as it is. |
| `GET /api/v1/templates/{id}/root` | The render input: `{ kind, name, entryJson, members }`, the root as the legacy catalog wrapper plus the name, role and tags of the other entities, to draw the root graph without downloading the file. |

A bad parameter is a `400` with a readable `code` (`invalid_language`, `invalid_limit`, `invalid_offset`,
`too_many_tags`); an unknown id is a `404 template_not_found`. Lists, details, roots and files are cached five minutes
(`Cache-Control: public, max-age=300, stale-while-revalidate=3600`).

### A summary

```json
{ "id": "trip-manager-team", "version": "1.0.0", "name": "Trip Manager Team", "tagline": null, "description": "...",
  "tags": ["travel"], "language": "en",
  "author": { "id": "agentivity-labs", "name": "Agentivity Labs", "url": "https://agentivity.io", "avatarUrl": null, "bio": null }, "license": null,
  "cover": { "imageUrl": "https://.../storage/v1/object/public/template-covers/trip-manager-team.webp?v=...", "alt": "..." },
  "root": { "kind": "team", "id": "8a11e785-...", "name": "Trip Manager Team" },
  "counts": { "agents": 13, "teams": 1, "workflows": 0, "dataTables": 2 },
  "requires": { "credentials": ["llm"], "plugins": [] },
  "sizeBytes": 230502, "createdAt": "2026-10-09T10:00:00Z", "updatedAt": "2026-10-11T08:00:00Z" }
```

## Setup

```
npm install
cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev
npm test               # the filters, the shapes of the answers, the errors (no database needed)
```

The tables and the `template-covers` storage bucket are created by `agentivity_marketplace_content/migrations/2026-10-templates.sql`
(run it in the Supabase SQL Editor **before** deploying this version: it reads the new columns).

## Deploying

Standard Next.js app (no static export: the API routes need a server), deploys as-is on Vercel. Set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` as environment variables of the Vercel project (never commit `.env`). Order of the move: the migration,
this deployment, then the publication of the Templates.
