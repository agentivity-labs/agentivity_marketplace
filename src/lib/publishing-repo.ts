// Publishing as Supabase holds it (see agentivity_marketplace_content/migrations/2026-11-template-publishing.sql). Server-only: the
// service_role key (supabase.ts). The files sent wait in the private bucket template-submissions; covers go to template-covers.
import { createHash, randomUUID } from 'node:crypto'
import type { Author, Listed, PublishingStore, Submission } from './publishing.ts'
import { supabase } from './supabase.ts'

const SUBMISSIONS = 'template-submissions'
const COVERS = 'template-covers'

type SubmissionRow = {
  id: string
  slug: string
  version: string
  author_id: string
  person_id: string
  email: string
  workspace: string | null
  status: Submission['status']
  reason: string | null
  file_path: string
  summary: Submission['summary']
  warnings: string[]
  submitted_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

const toSubmission = (r: SubmissionRow): Submission => ({
  id: r.id,
  slug: r.slug,
  version: r.version,
  authorId: r.author_id,
  personId: r.person_id,
  email: r.email,
  workspace: r.workspace,
  status: r.status,
  reason: r.reason,
  filePath: r.file_path,
  summary: r.summary,
  warnings: r.warnings ?? [],
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at,
  reviewedBy: r.reviewed_by,
})

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

const toAuthor = (a: { id: string; name: string; url: string | null }): Author => ({ id: a.id, name: a.name, url: a.url ?? null })

export const publishing: PublishingStore = {
  async authorOfPerson(personId) {
    const row = check(await supabase.from('author_owners').select('author:authors(id, name, url)').eq('person_id', personId).maybeSingle())
    const author = (row as { author?: { id: string; name: string; url: string | null } } | null)?.author
    return author ? toAuthor(author) : null
  },

  async author(id) {
    const author = check(await supabase.from('authors').select('id, name, url').eq('id', id).maybeSingle())
    if (!author) return null
    const owner = check(await supabase.from('author_owners').select('person_id').eq('author_id', id).maybeSingle())
    return { author: toAuthor(author), ownerPersonId: owner?.person_id ?? null }
  },

  async authorNamed(name) {
    const author = check(await supabase.from('authors').select('id, name, url').ilike('name', name.replace(/[%_\\]/g, (c) => `\\${c}`)).limit(1).maybeSingle())
    return author ? toAuthor(author) : null
  },

  async saveAuthor(author, ownerPersonId) {
    check(await supabase.from('authors').upsert({ id: author.id, name: author.name, url: author.url }, { onConflict: 'id' }))
    // One name per person: the one they had goes to the new one (a moderator giving a name to someone who had none).
    check(await supabase.from('author_owners').delete().eq('person_id', ownerPersonId).neq('author_id', author.id))
    check(await supabase.from('author_owners').upsert({ author_id: author.id, person_id: ownerPersonId }, { onConflict: 'author_id' }))
  },

  async listed(slug) {
    const row = check(await supabase.from('templates').select('slug, version, name, author_id, status').eq('slug', slug).maybeSingle())
    return row ? ({ slug: row.slug, version: row.version, name: row.name, authorId: row.author_id, status: row.status === 'withdrawn' ? 'withdrawn' : 'published' } as Listed) : null
  },

  async listedOfAuthor(authorId) {
    const rows = check(await supabase.from('templates').select('slug, version, name, author_id, status').eq('author_id', authorId))
    return (rows ?? []).map((row) => ({ slug: row.slug, version: row.version, name: row.name, authorId: row.author_id, status: row.status === 'withdrawn' ? 'withdrawn' : 'published' }) as Listed)
  },

  async submission(id) {
    const row = check(await supabase.from('template_submissions').select('*').eq('id', id).maybeSingle())
    return row ? toSubmission(row as SubmissionRow) : null
  },

  async submissions(filter) {
    let query = supabase.from('template_submissions').select('*')
    if (filter.slug) query = query.eq('slug', filter.slug)
    if (filter.personId) query = query.eq('person_id', filter.personId)
    if (filter.status) query = query.eq('status', filter.status)
    return (check(await query.order('submitted_at')) ?? []).map((row) => toSubmission(row as SubmissionRow))
  },

  async addSubmission(s) {
    check(
      await supabase.from('template_submissions').insert({
        id: s.id,
        slug: s.slug,
        version: s.version,
        author_id: s.authorId,
        person_id: s.personId,
        email: s.email,
        workspace: s.workspace,
        status: s.status,
        reason: s.reason,
        file_path: s.filePath,
        summary: s.summary,
        warnings: s.warnings,
        submitted_at: s.submittedAt,
      }),
    )
  },

  async updateSubmission(id, patch) {
    check(
      await supabase
        .from('template_submissions')
        .update({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          ...(patch.reviewedAt !== undefined ? { reviewed_at: patch.reviewedAt } : {}),
          ...(patch.reviewedBy !== undefined ? { reviewed_by: patch.reviewedBy } : {}),
        })
        .eq('id', id),
    )
  },

  async createUpload(personId) {
    const uploadId = randomUUID()
    const filePath = `${personId}/${uploadId}.template.json`
    const signed = check(await supabase.storage.from(SUBMISSIONS).createSignedUploadUrl(filePath))
    if (!signed) throw new Error('The storage gave no address to send the file to.')
    return { uploadId, uploadUrl: signed.signedUrl, filePath }
  },

  async readFile(filePath) {
    const { data, error } = await supabase.storage.from(SUBMISSIONS).download(filePath)
    if (error || !data) return null
    return await data.text()
  },

  async storeCover(slug, picture) {
    const name = `${slug}.${picture.extension}`
    check(await supabase.storage.from(COVERS).upload(name, picture.bytes, { contentType: picture.mime, upsert: true }))
    const version = createHash('sha256').update(picture.bytes).digest('hex').slice(0, 12)
    return `${supabase.storage.from(COVERS).getPublicUrl(name).data.publicUrl}?v=${version}`
  },

  async publish(row) {
    check(await supabase.from('templates').upsert(row, { onConflict: 'slug' }))
  },

  async setStatus(slug, status) {
    check(await supabase.from('templates').update({ status }).eq('slug', slug))
  },
}
