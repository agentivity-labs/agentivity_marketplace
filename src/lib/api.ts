import { NextResponse } from 'next/server'

// Uniform response envelope for every /api/v1/* route:
//   success: { data: T }              (single resource)
//   success: { data: T[], meta: {…} } (list — meta carries pagination/filters)
//   error:   { error: { code, message } }
// Keeping this consistent now means new v1 endpoints don't invent their own
// shape, and a future v2 can change the envelope without touching v1 clients.

export function apiSuccess<T>(data: T, meta?: Record<string, unknown>, init?: number) {
  return NextResponse.json(meta ? { data, meta } : { data }, { status: init ?? 200 })
}

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
