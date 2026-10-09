import { NextResponse } from 'next/server.js'
import type { Result } from './catalog.ts'

// Uniform response envelope for every /api/v1/* route:
//   success: { data: T }              (single resource)
//   success: { data: T[], meta: {…} } (list — meta carries pagination)
//   error:   { error: { code, message } }
// The one exception is the file download, which is the Template file itself.

// This is a public, read-only, non-authenticated catalog — allowing any origin is intentional so it can be fetched directly from
// browser JS on other sites (agentivity_synergi) and from Studio (web/desktop), not just same-origin.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** The catalogue changes when the founder publishes: five minutes of cache, then an hour of stale answers while it refreshes. */
export const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600'

export const TEMPLATE_MEDIA_TYPE = 'application/vnd.agentivity.template+json'

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>, init?: number, headers?: Record<string, string>) {
  return NextResponse.json(meta ? { data, meta } : { data }, { status: init ?? 200, headers: { ...CORS_HEADERS, ...headers } })
}

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: CORS_HEADERS })
}

/** What a handler of catalog.ts answered, as an HTTP response. */
export function respond(result: Result) {
  switch (result.kind) {
    case 'data':
      return apiSuccess(result.data, result.meta, 200, { 'Cache-Control': CACHE_CONTROL })
    case 'file':
      return new NextResponse(result.json, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': `${TEMPLATE_MEDIA_TYPE}; charset=utf-8`,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': CACHE_CONTROL,
        },
      })
    case 'error':
      return apiError(result.code, result.message, result.status)
  }
}

/** The answer to a browser's preflight request. */
export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
