// What the API says about a Template, and how a request is understood. Pure: no database, no framework, so it can be tested alone.
// The shapes are those of section 10 of template-format.md (agentivity_service/.. /delivery/features/templates).

export const DEFAULT_LIMIT = 24
export const MAX_LIMIT = 100
export const MAX_TAGS_FILTER = 12

/** The columns a list or a detail needs. Never `content` or `root_view`: they are heavy, they have their own endpoints. */
export const SUMMARY_COLUMNS =
  'slug, version, name, tagline, description, tags, language, author:authors(id, name, url, avatar_url, bio), license, cover_url, cover_alt, root_kind, root_id, root_name, counts, requires, size_bytes, template_created_at, created_at, updated_at'

export type TemplateRow = {
  slug: string
  version: string
  name: string
  tagline: string | null
  description: string
  tags: string[]
  language: string
  author: { id: string; name: string; url: string | null; avatar_url: string | null; bio: string | null }
  license: string | null
  cover_url: string | null
  cover_alt: string | null
  root_kind: 'agent' | 'team' | 'workflow'
  root_id: string
  root_name: string
  counts: { agents: number; teams: number; workflows: number; dataTables: number }
  requires: { credentials: string[]; plugins: string[] }
  size_bytes: number
  template_created_at: string | null
  created_at: string
  updated_at: string
  contents?: ContentLine[]
}

export type ContentLine = { kind: string; id: string; name: string; role: string | null; depth: number }

export type ListParams = {
  q?: string
  tags: string[]
  language?: string
  author?: string
  limit: number
  offset: number
}

export type ParseResult = { ok: true; value: ListParams } | { ok: false; code: string; message: string }

const LANGUAGES = ['en', 'zh', 'hi', 'es', 'fr', 'ar', 'pt', 'ru', 'de', 'ja']

/** Reads and checks the query string of `GET /templates`. A bad value is a readable 400, never silently ignored. */
export function parseListParams(searchParams: URLSearchParams): ParseResult {
  const q = searchParams.get('q')?.trim() || undefined
  const author = searchParams.get('author')?.trim().toLowerCase() || undefined
  const language = searchParams.get('language')?.trim().toLowerCase() || undefined
  const tags = [...new Set(searchParams.getAll('tag').flatMap((t) => t.split(',')).map((t) => t.trim().toLowerCase()).filter(Boolean))]

  if (language && !LANGUAGES.includes(language)) {
    return { ok: false, code: 'invalid_language', message: `language must be one of: ${LANGUAGES.join(', ')}` }
  }
  if (tags.length > MAX_TAGS_FILTER) {
    return { ok: false, code: 'too_many_tags', message: `At most ${MAX_TAGS_FILTER} tags can be combined` }
  }

  const limitText = searchParams.get('limit')
  const offsetText = searchParams.get('offset')
  const limit = limitText === null || limitText === '' ? DEFAULT_LIMIT : Number(limitText)
  const offset = offsetText === null || offsetText === '' ? 0 : Number(offsetText)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { ok: false, code: 'invalid_limit', message: `limit must be a whole number from 1 to ${MAX_LIMIT}` }
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return { ok: false, code: 'invalid_offset', message: 'offset must be a whole number, 0 or more' }
  }

  return { ok: true, value: { q, tags, language, author, limit, offset } }
}

/**
 * The text a visitor typed, as a Postgres `to_tsquery` expression that matches the start of every word ("seo cont" finds "SEO content").
 * Only letters and digits survive, so nothing the visitor types can change the meaning of the query.
 */
export function searchExpression(q: string | undefined): string | undefined {
  const words = (q ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.length === 0 ? undefined : words.map((w) => `${w}:*`).join(' & ')
}

/** The minimum of the query builder this API uses, so the filters can be checked without a database. */
export interface Filterable<T> {
  eq(column: string, value: unknown): T
  contains(column: string, value: unknown[]): T
  textSearch(column: string, query: string, options: { config: string }): T
}

/** What every list of the catalogue is limited to, then what the visitor asked for. */
export function applyListFilters<T extends Filterable<T>>(query: T, params: ListParams): T {
  let result = query.eq('status', 'published').eq('visibility', 'public')
  if (params.author) result = result.eq('author_id', params.author)
  if (params.tags.length > 0) result = result.contains('tags', params.tags)
  if (params.language) result = result.eq('language', params.language)
  const expression = searchExpression(params.q)
  if (expression) result = result.textSearch('search', expression, { config: 'simple' })
  return result
}

/** One Template as a card needs it (list item, and the head of the detail). */
export function toSummary(row: TemplateRow) {
  return {
    id: row.slug,
    version: row.version,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    tags: row.tags,
    language: row.language,
    author: { id: row.author.id, name: row.author.name, url: row.author.url, avatarUrl: row.author.avatar_url, bio: row.author.bio },
    license: row.license,
    cover: row.cover_url ? { imageUrl: row.cover_url, alt: row.cover_alt } : null,
    root: { kind: row.root_kind, id: row.root_id, name: row.root_name },
    counts: row.counts,
    requires: row.requires,
    sizeBytes: row.size_bytes,
    createdAt: row.template_created_at ?? row.created_at,
    updatedAt: row.updated_at,
  }
}

/** The summary plus what the Template contains (no entity bodies). */
export function toDetail(row: TemplateRow) {
  return { ...toSummary(row), contents: row.contents ?? [] }
}
