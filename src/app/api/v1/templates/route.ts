import { NextRequest } from 'next/server'
import { apiError, preflight, respond } from '@/lib/api'
import { listTemplates } from '@/lib/catalog'
import { catalog } from '@/lib/repo'

// GET /api/v1/templates?q=&tag=&language=&author=&limit=&offset=
// The Templates (a use case = one file), as summaries: no content, that is what /file and /root are for.
// `tag` can be repeated (all must match). Sorted by name.
export async function GET(request: NextRequest) {
  try {
    return respond(await listTemplates(catalog, request.nextUrl.searchParams))
  } catch (error) {
    return apiError('query_failed', error instanceof Error ? error.message : 'The catalogue could not be read', 500)
  }
}

export const OPTIONS = preflight
