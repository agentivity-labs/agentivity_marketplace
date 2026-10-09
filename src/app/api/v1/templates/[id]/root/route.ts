import { apiError, preflight, respond } from '@/lib/api'
import { getTemplateRoot } from '@/lib/catalog'
import { catalog } from '@/lib/repo'

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/v1/templates/{id}/root — what a card or a page needs to draw the graph of the root without downloading the whole file:
// { kind, name, entryJson, members } (the root as the legacy catalog wrapper, plus name, role and tags of the other entities).
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  try {
    return respond(await getTemplateRoot(catalog, id))
  } catch (error) {
    return apiError('query_failed', error instanceof Error ? error.message : 'The catalogue could not be read', 500)
  }
}

export const OPTIONS = preflight
