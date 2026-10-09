import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CACHE_CONTROL, respond } from '../src/lib/api.ts'
import { type Catalog, getTemplate, getTemplateFile, getTemplateRoot, listTemplates } from '../src/lib/catalog.ts'
import { type Filterable, type ListParams, type TemplateRow, applyListFilters, parseListParams, searchExpression, toDetail, toSummary } from '../src/lib/templates.ts'

const row = (slug: string, extra: Partial<TemplateRow> = {}): TemplateRow => ({
  slug,
  version: '1.0.0',
  name: `Template ${slug}`,
  tagline: 'A tagline',
  description: 'What it does and for whom, in a few words.',
  tags: ['seo', 'marketing'],
  language: 'en',
  author: { id: 'agentivity', name: 'Agentivity', url: 'https://agentivity.io', avatar_url: null, bio: null },
  license: null,
  cover_url: `https://cdn.example/${slug}.webp?v=1`,
  cover_alt: 'A pen and a calendar',
  root_kind: 'team',
  root_id: 'team-1',
  root_name: 'SEO team',
  counts: { agents: 2, teams: 1, workflows: 0, dataTables: 1 },
  requires: { credentials: ['llm'], plugins: [] },
  size_bytes: 4096,
  template_created_at: '2026-10-09T10:00:00Z',
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-11T08:00:00Z',
  contents: [{ kind: 'team', id: 'team-1', name: 'SEO team', role: 'Turns a keyword into an article.', depth: 0 }],
  ...extra,
})

const file = { schema: 'agentivity.template', id: 'seo-factory', cover: { imageUrl: 'https://cdn.example/seo-factory.webp?v=1', alt: 'A pen' }, entities: [] }
const rootView = { kind: 'team', name: 'SEO team', entryJson: '{"id":"team-1"}', members: { a1: { kind: 'agent', name: 'Writer', role: 'Writes', tags: [] } } }

function fakeCatalog(rows: TemplateRow[] = [row('seo-factory'), row('invoice-clerk')]): Catalog & { lastList?: ListParams } {
  const fake: Catalog & { lastList?: ListParams } = {
    async list(params) {
      fake.lastList = params
      return { rows: rows.slice(params.offset, params.offset + params.limit), total: rows.length }
    },
    async get(id) {
      return rows.find((r) => r.slug === id) ?? null
    },
    async file(id) {
      return id === 'seo-factory' ? file : null
    },
    async root(id) {
      return id === 'seo-factory' ? rootView : null
    },
  }
  return fake
}

const params = (query: string) => new URLSearchParams(query)

/** A query builder that only writes down what it is asked. */
function recorder() {
  const calls: unknown[][] = []
  type Builder = Filterable<Builder>
  const builder: Builder = {
    eq: (...args) => (calls.push(['eq', ...args]), builder),
    contains: (...args) => (calls.push(['contains', ...args]), builder),
    textSearch: (...args) => (calls.push(['textSearch', ...args]), builder),
  }
  return { builder, calls }
}

describe('reading the query string', () => {
  it('has defaults', () => {
    assert.deepEqual(parseListParams(params('')), { ok: true, value: { q: undefined, tags: [], language: undefined, author: undefined, limit: 24, offset: 0 } })
  })

  it('takes every filter, tags repeated or separated by commas, without duplicates', () => {
    const result = parseListParams(params('q=seo%20content&author=Agentivity&tag=SEO&tag=marketing,seo&language=FR&limit=10&offset=20'))
    assert.deepEqual(result, { ok: true, value: { q: 'seo content', tags: ['seo', 'marketing'], language: 'fr', author: 'agentivity', limit: 10, offset: 20 } })
  })

  it('refuses what it does not understand, with a readable code', () => {
    const code = (query: string) => {
      const result = parseListParams(params(query))
      return result.ok ? 'ok' : result.code
    }
    assert.equal(code('language=xx'), 'invalid_language')
    assert.equal(code('limit=0'), 'invalid_limit')
    assert.equal(code('limit=101'), 'invalid_limit')
    assert.equal(code('limit=abc'), 'invalid_limit')
    assert.equal(code('offset=-1'), 'invalid_offset')
    assert.equal(code('offset=1.5'), 'invalid_offset')
    assert.equal(code(Array.from({ length: 13 }, (_, i) => `tag=t${i}`).join('&')), 'too_many_tags')
    assert.equal(code('limit=100'), 'ok')
  })
})

describe('the filters', () => {
  it('always limit to what is published and public', () => {
    const { builder, calls } = recorder()
    applyListFilters(builder, { tags: [], limit: 24, offset: 0 })
    assert.deepEqual(calls, [['eq', 'status', 'published'], ['eq', 'visibility', 'public']])
  })

  it('apply all the tags, the language, the author and the search', () => {
    const { builder, calls } = recorder()
    applyListFilters(builder, { q: 'SEO cont', tags: ['seo', 'marketing'], language: 'en', author: 'agentivity', limit: 24, offset: 0 })
    assert.deepEqual(calls.slice(2), [
      ['eq', 'author_id', 'agentivity'],
      ['contains', 'tags', ['seo', 'marketing']],
      ['eq', 'language', 'en'],
      ['textSearch', 'search', 'seo:* & cont:*', { config: 'simple' }],
    ])
  })

  it('turn what is typed into a prefix search nothing can break out of', () => {
    assert.equal(searchExpression('SEO content'), 'seo:* & content:*')
    assert.equal(searchExpression("a' | !b & (c)"), 'a:* & b:* & c:*')
    assert.equal(searchExpression('  é-commerce  '), 'é:* & commerce:*')
    assert.equal(searchExpression('!!! ()'), undefined)
    assert.equal(searchExpression(undefined), undefined)
  })
})

describe('GET /templates', () => {
  it('lists the summaries with the page in meta', async () => {
    const result = await listTemplates(fakeCatalog(), params('limit=1&offset=1'))
    assert.equal(result.kind, 'data')
    if (result.kind !== 'data') return
    assert.deepEqual(result.meta, { total: 2, limit: 1, offset: 1 })
    assert.deepEqual((result.data as { id: string }[]).map((t) => t.id), ['invoice-clerk'])
  })

  it('a summary has exactly the shape of the format, and no heavy field', async () => {
    const result = await listTemplates(fakeCatalog([row('seo-factory')]), params(''))
    if (result.kind !== 'data') throw new Error('expected data')
    const [summary] = result.data as Record<string, unknown>[]
    assert.deepEqual(Object.keys(summary).sort(), ['author', 'counts', 'cover', 'createdAt', 'description', 'id', 'language', 'license', 'name', 'requires', 'root', 'sizeBytes', 'tagline', 'tags', 'updatedAt', 'version'])
    assert.deepEqual(summary.root, { kind: 'team', id: 'team-1', name: 'SEO team' })
    assert.deepEqual(summary.author, { id: 'agentivity', name: 'Agentivity', url: 'https://agentivity.io', avatarUrl: null, bio: null })
    assert.ok(!('labels' in summary))
    assert.deepEqual(summary.cover, { imageUrl: 'https://cdn.example/seo-factory.webp?v=1', alt: 'A pen and a calendar' })
    assert.equal(summary.createdAt, '2026-10-09T10:00:00Z')
    assert.equal(summary.sizeBytes, 4096)
    assert.ok(!('contents' in summary) && !('content' in summary))
  })

  it('a Template without a cover has a null cover; without a creation date it uses the one of the row', () => {
    const summary = toSummary(row('x-template', { cover_url: null, cover_alt: null, template_created_at: null }))
    assert.equal(summary.cover, null)
    assert.equal(summary.createdAt, '2026-10-10T08:00:00Z')
  })

  it('a bad parameter is a 400 and the catalogue is not even asked', async () => {
    const catalog = fakeCatalog()
    const result = await listTemplates(catalog, params('language=xx'))
    assert.equal(result.kind === 'error' && result.code, 'invalid_language')
    assert.equal(catalog.lastList, undefined)
  })
})

describe('GET /templates/{id}', () => {
  it('is the summary plus the contents', async () => {
    const result = await getTemplate(fakeCatalog(), 'seo-factory')
    if (result.kind !== 'data') throw new Error('expected data')
    assert.deepEqual(result.data, toDetail(row('seo-factory')))
    assert.deepEqual((result.data as { contents: unknown[] }).contents, [{ kind: 'team', id: 'team-1', name: 'SEO team', role: 'Turns a keyword into an article.', depth: 0 }])
  })

  it('is a 404 template_not_found for an unknown id', async () => {
    assert.deepEqual(await getTemplate(fakeCatalog(), 'nope'), { kind: 'error', status: 404, code: 'template_not_found', message: 'No Template with the id "nope"' })
  })
})

describe('GET /templates/{id}/file', () => {
  it('is exactly what is stored, named after the id', async () => {
    const result = await getTemplateFile(fakeCatalog(), 'seo-factory')
    assert.deepEqual(result, { kind: 'file', filename: 'seo-factory.template.json', json: JSON.stringify(file) })
  })

  it('is downloaded as an attachment of the Template media type, cached and open to every origin', async () => {
    const response = respond(await getTemplateFile(fakeCatalog(), 'seo-factory'))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.agentivity.template+json; charset=utf-8')
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="seo-factory.template.json"')
    assert.equal(response.headers.get('cache-control'), CACHE_CONTROL)
    assert.equal(response.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(JSON.parse(await response.text()), file, 'the body is the file itself, not wrapped in { data }')
  })

  it('is a 404 for an unknown id', async () => {
    const response = respond(await getTemplateFile(fakeCatalog(), 'nope'))
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: { code: 'template_not_found', message: 'No Template with the id "nope"' } })
  })
})

describe('GET /templates/{id}/root', () => {
  it('is the render input: the root as a wrapper, with its members', async () => {
    const response = respond(await getTemplateRoot(fakeCatalog(), 'seo-factory'))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: rootView })
  })

  it('is a 404 for an unknown id', async () => {
    assert.equal((await getTemplateRoot(fakeCatalog(), 'nope')).kind, 'error')
  })
})

describe('the envelope', () => {
  it('a list answers { data, meta } with the cache and CORS headers; an error answers { error } without cache', async () => {
    const list = respond(await listTemplates(fakeCatalog(), params('')))
    assert.equal(list.headers.get('cache-control'), CACHE_CONTROL)
    assert.equal(list.headers.get('access-control-allow-origin'), '*')
    const body = await list.json()
    assert.deepEqual(Object.keys(body), ['data', 'meta'])
    const error = respond(await listTemplates(fakeCatalog(), params('limit=0')))
    assert.equal(error.status, 400)
    assert.equal(error.headers.get('cache-control'), null)
    assert.deepEqual(Object.keys(await error.json()), ['error'])
  })
})
