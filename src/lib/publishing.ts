// Publishing from a workspace: a person publishes their Templates under the name they chose; what they send waits for a moderator,
// unless Ops lets them publish without review. An update of a published Template waits the same way, while the version online stays.
// Written against a small interface (PublishingStore) so it can be tested without Supabase; each call answers with a plain Result.
import type { Result } from './catalog.ts'
import { authorSlug, deriveRow, readDataUri } from './format/template-file.mjs'
import { validateTemplate } from './format/validate-template.mjs'
import type { Publisher } from './publish-token.ts'

export type Author = { id: string; name: string; url: string | null }

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

/** What a person sent, and what became of it. */
export type Submission = {
  id: string
  slug: string
  version: string
  authorId: string
  personId: string
  email: string
  workspace: string | null
  status: SubmissionStatus
  /** Why it was refused (said to its author), or why it was withdrawn. */
  reason: string | null
  /** Where the file waits (private storage). */
  filePath: string
  /** What a moderator and its author read without opening the file. */
  summary: { name: string; tagline: string | null; description: string; tags: string[]; language: string; counts: Record<string, number>; sizeBytes: number }
  warnings: string[]
  submittedAt: string
  reviewedAt: string | null
  reviewedBy: string | null
}

/** A Template of the catalogue, as far as publishing is concerned. */
export type Listed = { slug: string; version: string; name: string; authorId: string; status: 'published' | 'withdrawn' }

export interface PublishingStore {
  authorOfPerson(personId: string): Promise<Author | null>
  author(id: string): Promise<{ author: Author; ownerPersonId: string | null } | null>
  /** Another author with this name (any case), if there is one. */
  authorNamed(name: string): Promise<Author | null>
  /** Creates the author or changes its name and website, and gives it to `ownerPersonId`. */
  saveAuthor(author: Author, ownerPersonId: string): Promise<void>
  listed(slug: string): Promise<Listed | null>
  listedOfAuthor(authorId: string): Promise<Listed[]>
  submission(id: string): Promise<Submission | null>
  submissions(filter: { slug?: string; personId?: string; status?: SubmissionStatus }): Promise<Submission[]>
  addSubmission(submission: Submission): Promise<void>
  updateSubmission(id: string, patch: Partial<Pick<Submission, 'status' | 'reason' | 'reviewedAt' | 'reviewedBy'>>): Promise<void>
  /** An address the workspace sends the file to directly (the API takes no large body), and where it will be. */
  createUpload(personId: string): Promise<{ uploadId: string; uploadUrl: string; filePath: string }>
  /** The text of a file sent there; null when there is none. */
  readFile(filePath: string): Promise<string | null>
  /** Stores a cover picture where the catalogue serves it; returns its public address. */
  storeCover(slug: string, picture: { bytes: Buffer; extension: string; mime: string }): Promise<string>
  /** Writes the catalogue row of a Template, published. */
  publish(row: Record<string, unknown>): Promise<void>
  setStatus(slug: string, status: 'published' | 'withdrawn'): Promise<void>
  /** Deletes a Template for good: its catalogue row, its cover, and every sending of it with its file. */
  deleteTemplate(slug: string): Promise<void>
  /** Deletes these sendings for good, with their files. */
  deleteSubmissions(ids: string[]): Promise<void>
  /** Every Template of the catalogue, published or withdrawn. */
  allListed(): Promise<Listed[]>
}

const error = (status: number, code: string, message: string): Result => ({ kind: 'error', status, code, message })
const data = (value: unknown): Result => ({ kind: 'data', data: value })

const MAX_NAME = 60
const MAX_REASON = 1000

/** a > b, as versions: 1.2.0 > 1.1.9; a pre-release comes before its release (1.0.0-beta < 1.0.0). */
export function newerVersion(a: string, b: string): boolean {
  const parse = (v: string) => {
    const plain = v.split('+')[0]
    const dash = plain.indexOf('-')
    const [core, pre] = dash < 0 ? [plain, undefined] : [plain.slice(0, dash), plain.slice(dash + 1)]
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if ((x.parts[i] ?? 0) !== (y.parts[i] ?? 0)) return (x.parts[i] ?? 0) > (y.parts[i] ?? 0)
  }
  if (x.pre === y.pre) return false
  if (x.pre === null) return true
  if (y.pre === null) return false
  return x.pre > y.pre
}

// ── The person ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The name they publish under (null until they choose one), and whether they publish without review. */
export async function whoAmI(store: PublishingStore, publisher: Publisher): Promise<Result> {
  const author = await store.authorOfPerson(publisher.personId)
  return data({ author, trusted: publisher.trusted })
}

/** Chooses, or changes, the name a person publishes under. Unique in the catalogue: a name that is someone's, or Agentivity's, is refused. */
export async function chooseName(store: PublishingStore, publisher: Publisher, body: { name?: unknown; url?: unknown }): Promise<Result> {
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  const url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : null
  if (name.length < 2 || name.length > MAX_NAME) return error(400, 'invalid_name', `Your name must be 2 to ${MAX_NAME} characters.`)
  const slug = authorSlug({ name })
  if (slug.length < 2) return error(400, 'invalid_name', 'Your name needs letters or digits.')
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) return error(400, 'invalid_url', 'Your website must start with https://.')

  const mine = await store.authorOfPerson(publisher.personId)
  const named = await store.authorNamed(name)
  const sameSlug = await store.author(slug)
  const takenBy = [named, sameSlug?.author].find((a) => a && a.id !== mine?.id)
  if (takenBy) return error(409, 'name_taken', `"${name}" is already used by another author: choose another name.`)

  // The first name gives the author its id; a later change keeps it (the Templates point to it) and changes what is shown.
  const author: Author = { id: mine?.id ?? slug, name, url }
  await store.saveAuthor(author, publisher.personId)
  return data({ author, trusted: publisher.trusted })
}

/** Where the workspace sends the file: straight to the storage (a Template may weigh more than this API takes in one call). */
export async function startUpload(store: PublishingStore, publisher: Publisher): Promise<Result> {
  return data(await store.createUpload(publisher.personId))
}

/**
 * Publishes the file sent at `uploadId`: checked by the rules of the catalogue, under the person's name, a Template that is theirs
 * (or new) and a version above the one online. It waits for a moderator, unless they publish without review. A newer sending of
 * the same Template replaces the one still waiting.
 */
export async function submit(store: PublishingStore, publisher: Publisher, body: { uploadId?: unknown }, now = new Date()): Promise<Result> {
  const author = await store.authorOfPerson(publisher.personId)
  if (!author) return error(409, 'no_author_name', 'Choose the name you publish under first.')
  const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : ''
  if (!/^[A-Za-z0-9-]{8,64}$/.test(uploadId)) return error(400, 'invalid_upload', 'Send the file first, then publish it.')

  const filePath = `${publisher.personId}/${uploadId}.template.json`
  const rawText = await store.readFile(filePath)
  if (rawText === null) return error(404, 'upload_not_found', 'The file was not received: send it again.')

  let file: Record<string, unknown>
  try {
    file = JSON.parse(rawText)
  } catch {
    return error(400, 'not_json', 'This file is not a Template.')
  }
  // The name under which it is shown is the person's, whatever the file says.
  file.author = { id: author.id, name: author.name, ...(author.url ? { url: author.url } : {}) }
  const checked = validateTemplate(file, { rawText: JSON.stringify(file) })
  if (!checked.ok) return { kind: 'error', status: 400, code: 'template_not_valid', message: checked.problems.map((p: { message: string }) => p.message).join(' ') }

  const slug = String(file.id)
  const version = String(file.version)
  const listed = await store.listed(slug)
  if (listed && listed.authorId !== author.id) return error(409, 'id_taken', `Another author already uses the ID "${slug}" for a Template: give yours another ID.`)
  const waiting = await store.submissions({ slug, status: 'pending' })
  if (waiting.some((s) => s.authorId !== author.id)) return error(409, 'id_taken', `Another author already uses the ID "${slug}" for a Template: give yours another ID.`)
  if (listed && listed.status === 'published' && !newerVersion(version, listed.version)) {
    return error(409, 'version_not_newer', `Version ${listed.version} is already online: give this one a higher version number, for example ${bump(listed.version)}.`)
  }

  for (const older of waiting) {
    await store.updateSubmission(older.id, { status: 'withdrawn', reason: `Replaced by version ${version}.`, reviewedAt: now.toISOString(), reviewedBy: null })
  }

  const submission: Submission = {
    id: uploadId,
    slug,
    version,
    authorId: author.id,
    personId: publisher.personId,
    email: publisher.email,
    workspace: publisher.workspace,
    status: 'pending',
    reason: null,
    filePath,
    summary: summaryOf(file, Buffer.byteLength(rawText)),
    warnings: (checked.warnings ?? []).map((w: { message: string }) => w.message),
    submittedAt: now.toISOString(),
    reviewedAt: null,
    reviewedBy: null,
  }
  await store.addSubmission(submission)
  if (publisher.trusted) return approveSubmission(store, submission.id, 'published without review', now)
  return data(view(submission, listed))
}

/** The person's Templates: each one with its version online (if any) and what became of its last sending. */
export async function myTemplates(store: PublishingStore, publisher: Publisher): Promise<Result> {
  const author = await store.authorOfPerson(publisher.personId)
  if (!author) return data([])
  const listed = await store.listedOfAuthor(author.id)
  const sent = await store.submissions({ personId: publisher.personId })
  const slugs = [...new Set([...listed.map((l) => l.slug), ...sent.map((s) => s.slug)])].sort()
  return data(
    slugs.map((slug) => {
      const online = listed.find((l) => l.slug === slug) ?? null
      // The last one sent; two sent in the same instant, the higher version.
      const last = sent.filter((s) => s.slug === slug).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || (newerVersion(b.version, a.version) ? 1 : -1))[0] ?? null
      return {
        id: slug,
        name: last?.summary.name ?? online?.name ?? slug,
        online: online ? { version: online.version, status: online.status } : null,
        lastSent: last ? { id: last.id, version: last.version, status: last.status, reason: last.reason, submittedAt: last.submittedAt, reviewedAt: last.reviewedAt } : null,
      }
    }),
  )
}

/**
 * Deletes a Template of theirs for good: out of the catalogue and out of their Templates, its cover and everything they sent of it.
 * Those who imported it keep their copy. Its ID is free again.
 */
export async function deleteTemplate(store: PublishingStore, publisher: Publisher, slug: string): Promise<Result> {
  const author = await store.authorOfPerson(publisher.personId)
  const listed = await store.listed(slug)
  const sent = await store.submissions({ slug, personId: publisher.personId })
  const theirs = author !== null && (listed ? listed.authorId === author.id : sent.length > 0)
  if (!theirs) return error(404, 'template_not_found', `You have no Template with the ID "${slug}".`)
  await store.deleteTemplate(slug)
  return data({ id: slug, deleted: true })
}

// ── The moderators (Ops) ──────────────────────────────────────────────────────────────────────────────────────────────────

/** What waits for review (or what was decided), the oldest first, with who sent it. */
export async function submissionsFor(store: PublishingStore, status: string | null): Promise<Result> {
  const wanted = (status ?? 'pending') as SubmissionStatus
  if (!['pending', 'approved', 'rejected', 'withdrawn'].includes(wanted)) return error(400, 'invalid_status', 'status is pending, approved, rejected or withdrawn.')
  const list = (await store.submissions({ status: wanted })).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
  return data(await Promise.all(list.map(async (s) => ({ ...view(s, await store.listed(s.slug)), email: s.email, workspace: s.workspace, authorId: s.authorId, warnings: s.warnings }))))
}

/** The file a moderator reads before deciding. */
export async function submissionFile(store: PublishingStore, id: string): Promise<Result> {
  const submission = await store.submission(id)
  const text = submission ? await store.readFile(submission.filePath) : null
  return submission && text ? { kind: 'file', filename: `${submission.slug}-${submission.version}.template.json`, json: text } : error(404, 'submission_not_found', 'There is no such sending.')
}

/** Puts a sending in the catalogue: its cover where pictures are served, its row under its author's name. */
export async function approveSubmission(store: PublishingStore, id: string, reviewer: string, now = new Date()): Promise<Result> {
  const submission = await store.submission(id)
  if (!submission) return error(404, 'submission_not_found', 'There is no such sending.')
  if (submission.status !== 'pending') return error(409, 'not_pending', `This sending is ${submission.status}: nothing to decide.`)
  const rawText = await store.readFile(submission.filePath)
  const owner = await store.author(submission.authorId)
  if (rawText === null || !owner) return error(409, 'submission_incomplete', 'Its file or its author is gone: it cannot be published.')

  const file = JSON.parse(rawText)
  file.author = { id: owner.author.id, name: owner.author.name, ...(owner.author.url ? { url: owner.author.url } : {}) }
  const picture = readDataUri(file.cover?.dataUri)
  const coverUrl = picture?.extension ? await store.storeCover(submission.slug, { bytes: picture.bytes, extension: picture.extension, mime: picture.mime }) : undefined
  const row = deriveRow(file, { coverUrl, sizeBytes: Buffer.byteLength(rawText) })
  await store.publish({ ...row, author_id: owner.author.id, status: 'published', visibility: 'public' })
  await store.updateSubmission(id, { status: 'approved', reason: null, reviewedAt: now.toISOString(), reviewedBy: reviewer })
  // The version online is the only one kept: the catalogue serves its own copy, and an older sending approved before is history nobody reads.
  const older = (await store.submissions({ slug: submission.slug, status: 'approved' })).filter((s) => s.id !== id)
  if (older.length > 0) await store.deleteSubmissions(older.map((s) => s.id))
  return data(view({ ...submission, status: 'approved', reviewedAt: now.toISOString(), reviewedBy: reviewer }, await store.listed(submission.slug)))
}

/**
 * Removes the approved sendings older than the version of each Template kept: the ones approved before a later version was (the
 * catalogue only ever serves the last). Refused and withdrawn sendings stay, with why. Says how many were removed.
 */
export async function pruneApproved(store: PublishingStore): Promise<Result> {
  const approved = await store.submissions({ status: 'approved' })
  const gone: string[] = []
  for (const slug of new Set(approved.map((s) => s.slug))) {
    const ofIt = approved.filter((s) => s.slug === slug)
    const online = (await store.listed(slug))?.version
    const kept = ofIt.find((s) => s.version === online) ?? ofIt.reduce((a, b) => (newerVersion(b.version, a.version) ? b : a))
    gone.push(...ofIt.filter((s) => s.id !== kept.id).map((s) => s.id))
  }
  if (gone.length > 0) await store.deleteSubmissions(gone)
  return data({ removed: gone.length })
}

/** Every Template of the catalogue, for moderators: published or withdrawn, by name. */
export async function catalogueForModerators(store: PublishingStore): Promise<Result> {
  const all = await store.allListed()
  return data(all.sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.slug, name: t.name, version: t.version, authorId: t.authorId, status: t.status })))
}

/** Refuses a sending, saying why: its author reads the reason in their workspace. */
export async function rejectSubmission(store: PublishingStore, id: string, reviewer: string, body: { reason?: unknown }, now = new Date()): Promise<Result> {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3 || reason.length > MAX_REASON) return error(400, 'reason_required', `Say why, in 3 to ${MAX_REASON} characters: the author reads it.`)
  const submission = await store.submission(id)
  if (!submission) return error(404, 'submission_not_found', 'There is no such sending.')
  if (submission.status !== 'pending') return error(409, 'not_pending', `This sending is ${submission.status}: nothing to decide.`)
  await store.updateSubmission(id, { status: 'rejected', reason, reviewedAt: now.toISOString(), reviewedBy: reviewer })
  return data(view({ ...submission, status: 'rejected', reason, reviewedAt: now.toISOString(), reviewedBy: reviewer }, await store.listed(submission.slug)))
}

/** Takes any Template out of the catalogue (a moderator's decision). */
export async function withdrawTemplate(store: PublishingStore, slug: string): Promise<Result> {
  const listed = await store.listed(slug)
  if (!listed) return error(404, 'template_not_found', `No Template with the id "${slug}".`)
  await store.setStatus(slug, 'withdrawn')
  return data({ id: slug, status: 'withdrawn' })
}

/** Gives an author name to a person (the names the catalogue had before anyone published from a workspace, like "Agentivity Labs"). */
export async function giveAuthor(store: PublishingStore, authorId: string, body: { personId?: unknown }): Promise<Result> {
  const personId = typeof body.personId === 'string' ? body.personId.trim() : ''
  if (!personId) return error(400, 'person_required', 'Say whose name it becomes (their id at accounts_service).')
  const found = await store.author(authorId)
  if (!found) return error(404, 'author_not_found', `No author "${authorId}".`)
  const theirs = await store.authorOfPerson(personId)
  if (theirs && theirs.id !== authorId) return error(409, 'person_has_author', `This person already publishes as "${theirs.name}".`)
  await store.saveAuthor(found.author, personId)
  return data({ author: found.author, personId })
}

// ── Shapes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function bump(version: string): string {
  const [major, minor, patch] = version.split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  return `${major}.${minor}.${patch + 1}`
}

function summaryOf(file: Record<string, any>, sizeBytes: number): Submission['summary'] {
  const kinds = (file.entities ?? []).map((e: { kind?: string }) => e?.kind)
  const count = (kind: string) => kinds.filter((k: string) => k === kind).length
  return {
    name: String(file.name ?? file.id),
    tagline: typeof file.tagline === 'string' ? file.tagline : null,
    description: String(file.description ?? ''),
    tags: Array.isArray(file.tags) ? file.tags : [],
    language: String(file.language ?? 'en'),
    counts: {
      solutions: Array.isArray(file.roots) && file.roots.length > 0 ? file.roots.length : 1,
      teams: count('team'),
      agents: count('agent'),
      workflows: count('workflow'),
      dataTables: count('datatable'),
      knowledgeBases: count('knowledgebase'),
    },
    sizeBytes,
  }
}

function view(s: Submission, listed: Listed | null) {
  return {
    id: s.id,
    templateId: s.slug,
    version: s.version,
    status: s.status,
    reason: s.reason,
    summary: s.summary,
    online: listed ? { version: listed.version, status: listed.status } : null,
    submittedAt: s.submittedAt,
    reviewedAt: s.reviewedAt,
    reviewedBy: s.reviewedBy,
  }
}
