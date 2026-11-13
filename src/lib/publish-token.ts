// Who publishes: a person of a hosted workspace, as accounts_service vouches for them. The workspace asks accounts_service for a
// short token (ES256: ECDSA P-256, JWT form) and sends it with what the person publishes; this API only checks it with accounts_service's
// public key (PUBLISH_TOKEN_PUBLIC_KEY), never with a secret of its own. Zero dependencies: node:crypto.
import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/** Who the token says publishes, and whether Ops lets them publish without review. */
export type Publisher = {
  /** The person's stable id at accounts_service: their Templates and their author name follow it, whatever the workspace. */
  personId: string
  email: string
  /** The workspace they publish from (for the moderators). */
  workspace: string | null
  /** Ops gave them "publish without review": what they send is published at once. */
  trusted: boolean
}

export const TOKEN_AUDIENCE = 'agentivity-marketplace'

export type TokenCheck = { ok: true; publisher: Publisher } | { ok: false; code: string; message: string }

function base64UrlJson(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

let cachedKey: { pem: string; key: KeyObject } | undefined

function keyOf(pem: string): KeyObject {
  if (cachedKey?.pem !== pem) cachedKey = { pem, key: createPublicKey(pem) }
  return cachedKey.key
}

/**
 * Reads "Authorization: Bearer <token>". `now` is in seconds (for tests). A token that is missing, badly signed, for another audience
 * or out of date is refused; so is every token when the public key is not set (nothing can be published, never by default).
 */
export function checkPublishToken(authorization: string | null, publicKeyPem: string | undefined, now = Math.floor(Date.now() / 1000)): TokenCheck {
  if (!publicKeyPem) return { ok: false, code: 'publishing_unavailable', message: 'Publishing is not open yet on this marketplace.' }
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) return { ok: false, code: 'unauthorized', message: 'Publish from your workspace: it says who you are.' }

  const parts = token.split('.')
  const header = parts.length === 3 ? base64UrlJson(parts[0]) : null
  const claims = parts.length === 3 ? base64UrlJson(parts[1]) : null
  if (!header || !claims || header.alg !== 'ES256') return { ok: false, code: 'unauthorized', message: 'This token is not one of Agentivity.' }

  let signed = false
  try {
    // A JWT's ECDSA signature is r and s side by side (IEEE P1363), not DER.
    signed = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: keyOf(publicKeyPem), dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))
  } catch {
    signed = false
  }
  if (!signed) return { ok: false, code: 'unauthorized', message: 'This token is not one of Agentivity.' }

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audience.includes(TOKEN_AUDIENCE)) return { ok: false, code: 'unauthorized', message: 'This token is not for the marketplace.' }
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, code: 'token_expired', message: 'This token has expired: publish again from your workspace.' }
  if (typeof claims.sub !== 'string' || claims.sub.trim() === '' || typeof claims.email !== 'string') {
    return { ok: false, code: 'unauthorized', message: 'This token does not say who publishes.' }
  }

  return {
    ok: true,
    publisher: {
      personId: claims.sub.trim(),
      email: claims.email.trim().toLowerCase(),
      workspace: typeof claims.ws === 'string' ? claims.ws : null,
      trusted: claims.trusted === true,
    },
  }
}

/** The moderators' calls (Ops, server to server): "Authorization: Bearer <MARKETPLACE_ADMIN_KEY>", compared in a constant time. */
export function isAdmin(authorization: string | null, adminKey: string | undefined): boolean {
  const given = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!adminKey || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(adminKey)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}
