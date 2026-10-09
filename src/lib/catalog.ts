// The four reads of the catalogue, written against a small interface so they can be tested without Supabase.
// Each one answers with a plain result; the route turns it into an HTTP response (see api.ts).
import { type ListParams, type TemplateRow, parseListParams, toDetail, toSummary } from './templates.ts'

export interface Catalog {
  /** The summaries of a page, and how many Templates match in all. */
  list(params: ListParams): Promise<{ rows: TemplateRow[]; total: number }>
  /** One Template with its content list; null when there is none. */
  get(id: string): Promise<TemplateRow | null>
  /** The file of a Template as stored (no cover.dataUri, cover.imageUrl instead); null when there is none. */
  file(id: string): Promise<Record<string, unknown> | null>
  /** The render input of the root; null when there is none. */
  root(id: string): Promise<Record<string, unknown> | null>
}

export type Result =
  | { kind: 'data'; data: unknown; meta?: Record<string, unknown> }
  | { kind: 'file'; filename: string; json: string }
  | { kind: 'error'; status: number; code: string; message: string }

const notFound = (id: string): Result => ({ kind: 'error', status: 404, code: 'template_not_found', message: `No Template with the id "${id}"` })

export async function listTemplates(catalog: Catalog, searchParams: URLSearchParams): Promise<Result> {
  const parsed = parseListParams(searchParams)
  if (!parsed.ok) return { kind: 'error', status: 400, code: parsed.code, message: parsed.message }
  const { rows, total } = await catalog.list(parsed.value)
  return { kind: 'data', data: rows.map(toSummary), meta: { total, limit: parsed.value.limit, offset: parsed.value.offset } }
}

export async function getTemplate(catalog: Catalog, id: string): Promise<Result> {
  const row = await catalog.get(id)
  return row ? { kind: 'data', data: toDetail(row) } : notFound(id)
}

export async function getTemplateFile(catalog: Catalog, id: string): Promise<Result> {
  const file = await catalog.file(id)
  return file ? { kind: 'file', filename: `${id}.template.json`, json: JSON.stringify(file) } : notFound(id)
}

export async function getTemplateRoot(catalog: Catalog, id: string): Promise<Result> {
  const root = await catalog.root(id)
  return root ? { kind: 'data', data: root } : notFound(id)
}
