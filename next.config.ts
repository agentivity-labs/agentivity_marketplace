import type { NextConfig } from 'next'

// No `output: 'export'` here (unlike agentivity_synergi) — this service needs
// live server-side API routes (per-request Supabase queries), not a static export.
const nextConfig: NextConfig = {}

export default nextConfig
