import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { apiError, CORS_HEADERS } from '@/lib/api'

interface Params {
  params: Promise<{ slug: string }>
}

// GET /api/v1/templates/{slug}/raw
// Returns `content` unwrapped (no { data } envelope) — the exact
// { kind, name, entryJson } entity wrapper a client can save as-is and reuse
// directly (download link, or import into a workspace). Kept separate from
// GET /api/v1/templates/{slug} (which stays uniform with the rest of v1) so
// consumers that just want the raw downloadable file don't have to unwrap it.
export async function GET(_request: Request, { params }: Params) {
  const { slug } = await params

  const { data, error } = await supabase.from('templates').select('content').eq('slug', slug).maybeSingle()

  if (error) return apiError('query_failed', error.message, 500)
  if (!data) return apiError('not_found', `No template with slug "${slug}"`, 404)

  return NextResponse.json(data.content, { headers: CORS_HEADERS })
}
