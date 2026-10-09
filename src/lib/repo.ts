// The catalogue as Supabase holds it. Server-only: it uses the service_role key (see supabase.ts).
import type { Catalog } from './catalog.ts'
import { supabase } from './supabase.ts'
import { SUMMARY_COLUMNS, type TemplateRow, applyListFilters } from './templates.ts'

export const catalog: Catalog = {
  async list(params) {
    const query = applyListFilters(
      supabase.from('templates').select(SUMMARY_COLUMNS, { count: 'exact' }).order('name').range(params.offset, params.offset + params.limit - 1),
      params,
    )
    const { data, error, count } = await query
    if (error) throw new Error(error.message)
    return { rows: (data ?? []) as unknown as TemplateRow[], total: count ?? 0 }
  },

  async get(id) {
    const { data, error } = await supabase
      .from('templates')
      .select(`${SUMMARY_COLUMNS}, contents`)
      .eq('slug', id)
      .eq('status', 'published')
      .eq('visibility', 'public')
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as unknown as TemplateRow | null) ?? null
  },

  async file(id) {
    const { data, error } = await supabase.from('templates').select('content').eq('slug', id).eq('status', 'published').eq('visibility', 'public').maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.content as Record<string, unknown> | undefined) ?? null
  },

  async root(id) {
    const { data, error } = await supabase.from('templates').select('root_view').eq('slug', id).eq('status', 'published').eq('visibility', 'public').maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.root_view as Record<string, unknown> | undefined) ?? null
  },
}
