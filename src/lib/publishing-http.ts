// The routes of publishing: who calls (a person by their token, Ops by its key), then the logic of publishing.ts. Never cached, never
// open to browsers of other sites: the workspace and Ops call them from their servers.
import { NextResponse } from 'next/server.js'
import { TEMPLATE_MEDIA_TYPE } from './api.ts'
import type { Result } from './catalog.ts'
import { checkPublishToken, isAdmin, type Publisher } from './publish-token.ts'

const PRIVATE = { 'Cache-Control': 'no-store' }

export function respondPrivate(result: Result) {
  switch (result.kind) {
    case 'data':
      return NextResponse.json(result.meta ? { data: result.data, meta: result.meta } : { data: result.data }, { status: 200, headers: PRIVATE })
    case 'file':
      return new NextResponse(result.json, { status: 200, headers: { ...PRIVATE, 'Content-Type': `${TEMPLATE_MEDIA_TYPE}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${result.filename}"` } })
    case 'error':
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status, headers: PRIVATE })
  }
}

const failed = (error: unknown) =>
  respondPrivate({ kind: 'error', status: 500, code: 'query_failed', message: error instanceof Error ? error.message : 'The marketplace could not be reached' })

/** A call of a person, from their workspace. */
export async function asPerson(request: Request, handle: (publisher: Publisher) => Promise<Result>) {
  const check = checkPublishToken(request.headers.get('authorization'), process.env.PUBLISH_TOKEN_PUBLIC_KEY)
  if (!check.ok) return respondPrivate({ kind: 'error', status: check.code === 'publishing_unavailable' ? 503 : 401, code: check.code, message: check.message })
  try {
    return respondPrivate(await handle(check.publisher))
  } catch (error) {
    return failed(error)
  }
}

/** A call of a moderator, through Ops. X-Reviewer says who decides (kept with the decision). */
export async function asModerator(request: Request, handle: (reviewer: string) => Promise<Result>) {
  if (!isAdmin(request.headers.get('authorization'), process.env.MARKETPLACE_ADMIN_KEY)) {
    return respondPrivate({ kind: 'error', status: 401, code: 'unauthorized', message: 'Only the moderators, through Ops.' })
  }
  try {
    return respondPrivate(await handle(request.headers.get('x-reviewer')?.trim() || 'Ops'))
  } catch (error) {
    return failed(error)
  }
}

/** The body as an object (an empty or broken one is an empty object: each handler says what is missing). */
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}
