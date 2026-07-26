import { supabase } from '@/lib/supabase'
import { apiSuccess, apiError } from '@/lib/api'

interface Params {
  params: Promise<{ slug: string }>
}

// GET /api/v1/templates/{slug}
// Full template resource, including `content` — the exact { kind, name,
// entryJson } wrapper a client downloads and re-creates as a new entity in
// its own workspace.
export async function GET(_request: Request, { params }: Params) {
  const { slug } = await params

  const { data, error } = await supabase.from('templates').select('*').eq('slug', slug).maybeSingle()

  if (error) return apiError('query_failed', error.message, 500)
  if (!data) return apiError('not_found', `No template with slug "${slug}"`, 404)

  return apiSuccess(data)
}
