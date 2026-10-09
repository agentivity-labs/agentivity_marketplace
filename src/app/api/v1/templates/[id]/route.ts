import { apiError, preflight, respond } from '@/lib/api'
import { getTemplate } from '@/lib/catalog'
import { catalog } from '@/lib/repo'

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/v1/templates/{id} — one Template: its summary, what it contains (kind, name, role, depth; no entity bodies) and what it requires.
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  try {
    return respond(await getTemplate(catalog, id))
  } catch (error) {
    return apiError('query_failed', error instanceof Error ? error.message : 'The catalogue could not be read', 500)
  }
}

export const OPTIONS = preflight
