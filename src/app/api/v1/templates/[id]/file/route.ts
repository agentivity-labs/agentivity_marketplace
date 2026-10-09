import { apiError, preflight, respond } from '@/lib/api'
import { getTemplateFile } from '@/lib/catalog'
import { catalog } from '@/lib/repo'

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/v1/templates/{id}/file — the download: the single Template file (every entity, the seed rows, cover.imageUrl), the same
// bytes the platform's importer reads. Not wrapped in { data }.
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  try {
    return respond(await getTemplateFile(catalog, id))
  } catch (error) {
    return apiError('query_failed', error instanceof Error ? error.message : 'The catalogue could not be read', 500)
  }
}

export const OPTIONS = preflight
