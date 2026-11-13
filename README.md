# agentivity_marketplace

Read-only REST API of the Agentivity marketplace: the **Templates**. A Template is one use case in one file (the main team or
workflow, everything it calls, seed rows, a cover picture), made in the Studio and published from `agentivity_marketplace_content`
into Supabase. Consumed by the Studio and by the public site (Synergi).

The format and this contract are described in `agentivity_service/.. /delivery/features/templates/template-format.md` (sections 2
and 10). People publish from their hosted workspace (see "Publishing" below); the founder can still publish with a script
(`agentivity_marketplace_content/scripts/publish.mjs`).

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

## Publishing (from a workspace)

A person of a hosted workspace publishes their Templates under the name they chose (unique in the catalogue). What they send waits
for a moderator, unless Ops lets them publish without review; an update waits the same way while the version online stays. The
workspace calls these routes from its server with a short token that accounts_service signs (ES256, `aud`
`agentivity-marketplace`, `sub` = the person's id, `email`, `ws`, `trusted`, `exp`); this API checks it with
`PUBLISH_TOKEN_PUBLIC_KEY`. Never cached, no CORS.

| Endpoint | Description |
|---|---|
| `GET /api/v1/me` | `{ author, trusted }`: the name they publish under (null until chosen). |
| `PUT /api/v1/me` | `{ name, url? }`: chooses or changes it. `409 name_taken` when it is someone's (or a name the catalogue had before: Ops gives those). |
| `POST /api/v1/me/uploads` | `{ uploadId, uploadUrl }`: the workspace PUTs the file to `uploadUrl`, straight to the private bucket `template-submissions` (a Template may be larger than a function takes). |
| `POST /api/v1/me/templates` | `{ uploadId }`: publishes it. Checked by the rules of the catalogue (`400 template_not_valid`), under the person's name, an id that is theirs (`409 id_taken`), a version above the one online (`409 version_not_newer`). Answers the sending, `pending` or `approved`. A newer sending replaces the one waiting. |
| `GET /api/v1/me/templates` | Their Templates: `online` (version, `published` or `withdrawn`) and `lastSent` (version, status, the reason of a refusal). |
| `POST /api/v1/me/templates/{id}/unpublish` | Takes it out of the catalogue, with what waits for review. |

Moderation, for Ops (server to server, `Authorization: Bearer <MARKETPLACE_ADMIN_KEY>`, `X-Reviewer: <who decides>`):

| Endpoint | Description |
|---|---|
| `GET /api/v1/admin/submissions?status=` | `pending` by default, oldest first, with the email and workspace of who sent it. |
| `GET /api/v1/admin/submissions/{id}/file` | The file sent. |
| `POST /api/v1/admin/submissions/{id}/approve` | Publishes it: the cover to `template-covers`, the row under its author's name. |
| `POST /api/v1/admin/submissions/{id}/reject` | `{ reason }` (3 to 1000 characters): its author reads it. |
| `POST /api/v1/admin/templates/{id}/withdraw` | Takes any Template out of the catalogue. |
| `PUT /api/v1/admin/authors/{id}/owner` | `{ personId }`: gives an author name to a person (Agentivity Labs to its founder). |

The rules a file must follow are a copy of `agentivity_marketplace_content/scripts/lib` (`src/lib/format/`); a test there checks the
copy. The tables are created by `agentivity_marketplace_content/migrations/2026-11-template-publishing.sql` (run it first).

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
`SUPABASE_SERVICE_ROLE_KEY` as environment variables of the Vercel project (never commit `.env`), and, to open publishing,
`PUBLISH_TOKEN_PUBLIC_KEY` and `MARKETPLACE_ADMIN_KEY`. Order of the move: the migration,
this deployment, then the publication of the Templates.
