import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { apiSuccess, apiError } from '@/lib/api'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 24

// GET /api/v1/templates?q=&kind=&department=&limit=&offset=
// Lists templates — summary fields only (no `content`, kept out to keep list
// payloads small; fetch /api/v1/templates/{slug} for the full downloadable JSON).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const q = params.get('q')?.trim()
  const kind = params.get('kind')?.trim()
  const department = params.get('department')?.trim()

  if (kind && !['agent', 'team', 'workflow'].includes(kind)) {
    return apiError('invalid_kind', 'kind must be one of: agent, team, workflow', 400)
  }

  const limit = Math.min(Math.max(Number(params.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(params.get('offset')) || 0, 0)

  let query = supabase
    .from('templates')
    .select('slug, name, description, department, kind, canvas_renderer, agent_count, updated_at', {
      count: 'exact',
    })
    .order('name')
    .range(offset, offset + limit - 1)

  if (kind) query = query.eq('kind', kind)
  if (department) query = query.eq('department', department)
  // Single-column ilike via the query builder — parameterized, no raw string
  // interpolation into the filter (unlike .or(), which would let `q` contain
  // PostgREST filter syntax such as commas and break out of the intended clause).
  if (q) query = query.ilike('name', `%${q}%`)

  const { data, error, count } = await query
  if (error) return apiError('query_failed', error.message, 500)

  return apiSuccess(data, { total: count ?? 0, limit, offset })
}
