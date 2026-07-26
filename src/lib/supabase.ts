import { createClient } from '@supabase/supabase-js'

// Server-only client — uses the service_role key, which bypasses Row Level
// Security. Next.js never inlines unprefixed env vars into the client bundle,
// but as a hard rule: only import this from `app/api/**/route.ts` files
// (server-side route handlers), never from a `'use client'` component.
//
// v1 is read-only (list/detail), so this is safe as-is. The moment this API
// gains a public, unauthenticated write path (e.g. vote counts), switch reads
// to the `anon` key + the RLS policy already defined in schema.sql, and keep
// service_role reserved for authenticated/admin operations only.
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

export const supabase = getSupabaseClient()
