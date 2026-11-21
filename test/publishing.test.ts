import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it } from 'node:test'
import { checkPublishToken, isAdmin, type Publisher } from '../src/lib/publish-token.ts'
import {
  type Author,
  type Listed,
  type PublishingStore,
  type Submission,
  approveSubmission,
  catalogueForModerators,
  chooseName,
  pruneApproved,
  giveAuthor,
  myTemplates,
  newerVersion,
  rejectSubmission,
  submissionsFor,
  submit,
  deleteTemplate,
  whoAmI,
  withdrawTemplate,
} from '../src/lib/publishing.ts'
import type { Result } from '../src/lib/catalog.ts'

// ── A store in memory ───────────────────────────────────────────────────────────────────────────────────────────────────────

function memoryStore() {
  const authors = new Map<string, { author: Author; ownerPersonId: string | null }>()
  const listed = new Map<string, Listed & { row?: Record<string, unknown> }>()
  const submissions = new Map<string, Submission>()
  const files = new Map<string, string>()
  const covers: string[] = []
  let uploads = 0
  const store: PublishingStore = {
    async authorOfPerson(personId) {
      return [...authors.values()].find((a) => a.ownerPersonId === personId)?.author ?? null
    },
    async author(id) {
      return authors.get(id) ?? null
    },
    async authorNamed(name) {
      return [...authors.values()].find((a) => a.author.name.toLowerCase() === name.toLowerCase())?.author ?? null
    },
    async saveAuthor(author, ownerPersonId) {
      authors.set(author.id, { author, ownerPersonId })
    },
    async listed(slug) {
      return listed.get(slug) ?? null
    },
    async listedOfAuthor(authorId) {
      return [...listed.values()].filter((l) => l.authorId === authorId)
    },
    async submission(id) {
      return submissions.get(id) ?? null
    },
    async submissions(filter) {
      return [...submissions.values()].filter((s) => (!filter.slug || s.slug === filter.slug) && (!filter.personId || s.personId === filter.personId) && (!filter.status || s.status === filter.status))
    },
    async addSubmission(submission) {
      submissions.set(submission.id, submission)
    },
    async updateSubmission(id, patch) {
      submissions.set(id, { ...submissions.get(id)!, ...patch })
    },
    async createUpload(personId) {
      uploads += 1
      const uploadId = `upload-000${uploads}`
      return { uploadId, uploadUrl: `https://storage.example/${uploadId}`, filePath: `${personId}/${uploadId}.template.json` }
    },
    async readFile(filePath) {
      return files.get(filePath) ?? null
    },
    async storeCover(slug, picture) {
      covers.push(slug)
      return `https://cdn.example/${slug}.${picture.extension}`
    },
    async publish(row) {
      listed.set(String(row.slug), { slug: String(row.slug), version: String(row.version), name: String(row.name), authorId: String(row.author_id), status: 'published', row })
    },
    async setStatus(slug, status) {
      listed.set(slug, { ...listed.get(slug)!, status })
    },
    async deleteTemplate(slug) {
      listed.delete(slug)
      for (const [id, s] of submissions) if (s.slug === slug) { submissions.delete(id); files.delete(s.filePath) }
    },
    async deleteSubmissions(ids) {
      for (const id of ids) { files.delete(submissions.get(id)?.filePath ?? ''); submissions.delete(id) }
    },
    async allListed() {
      return [...listed.values()]
    },
  }
  return { store, authors, listed, submissions, files, covers }
}

const anna: Publisher = { personId: 'person-anna', email: 'anna@acme.co', workspace: 'acme', trusted: false }
const labs: Publisher = { personId: 'person-chris', email: 'chris@agentivity.io', workspace: 'agl', trusted: true }

const png = `data:image/png;base64,${Buffer.alloc(200).toString('base64')}`

function template(id = 'service-desk', version = '1.0.0') {
  const agent = (aid: string, name: string) => ({ kind: 'agent', id: aid, name, entry: { id: aid, name, role: `${name} does its part.`, tags: [], graph: { id: `g-${aid}`, entryNode: 'n', nodes: [], connections: [] } } })
  return {
    schema: 'agentivity.template',
    schemaVersion: 1,
    id,
    version,
    name: 'Service Desk',
    description: 'Employees ask the front desk; the service desk resolves the tickets it opens.',
    tags: ['support'],
    language: 'en',
    cover: { dataUri: png, alt: 'A help desk' },
    author: { name: 'Whoever the file says' },
    createdAt: '2026-11-13T10:00:00Z',
    root: { kind: 'team', id: 't1' },
    requires: { credentials: ['llm'], plugins: [] },
    entities: [
      { kind: 'team', id: 't1', name: 'Front Desk', entry: { id: 't1', name: 'Front Desk', role: 'Answers employees.', orchestratorId: 'handoff', tags: ['solution'], members: [{ topologyPositionId: 'p0', memberEntityId: 'a1', memberType: 'agent' }], connections: [] } },
      agent('a1', 'Receptionist'),
    ],
  }
}

async function send(world: ReturnType<typeof memoryStore>, publisher: Publisher, file: object): Promise<Result> {
  const upload = (await world.store.createUpload(publisher.personId))
  world.files.set(upload.filePath, JSON.stringify(file))
  return submit(world.store, publisher, { uploadId: upload.uploadId }, new Date('2026-11-13T12:00:00Z'))
}

const dataOf = (result: Result): any => {
  assert.equal(result.kind, 'data', result.kind === 'error' ? `${result.code}: ${result.message}` : '')
  return (result as { data: unknown }).data
}
const codeOf = (result: Result) => (result.kind === 'error' ? result.code : 'ok')

// ── The token ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('who publishes', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const token = (claims: Record<string, unknown>, key = privateKey) => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const signedPart = `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}`
    return `Bearer ${signedPart}.${sign('sha256', Buffer.from(signedPart), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  const good = { sub: 'person-anna', email: 'Anna@Acme.co', ws: 'acme', aud: 'agentivity-marketplace', exp: 2_000, trusted: false }

  it('is the person accounts_service vouches for, with what Ops lets them do', () => {
    const check = checkPublishToken(token(good), pem, 1_000)
    assert.deepEqual(check, { ok: true, publisher: { personId: 'person-anna', email: 'anna@acme.co', workspace: 'acme', trusted: false } })
    const trusted = checkPublishToken(token({ ...good, trusted: true }), pem, 1_000)
    assert.equal(trusted.ok && trusted.publisher.trusted, true)
  })

  it('refuses a token signed by another key, out of date, for another audience, or none at all; and everything when no key is set', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey
    assert.equal(checkPublishToken(token(good, other), pem, 1_000).ok, false)
    const expired = checkPublishToken(token(good), pem, 3_000)
    assert.equal(!expired.ok && expired.code, 'token_expired')
    assert.equal(checkPublishToken(token({ ...good, aud: 'someone-else' }), pem, 1_000).ok, false)
    assert.equal(checkPublishToken(null, pem, 1_000).ok, false)
    const closed = checkPublishToken(token(good), undefined, 1_000)
    assert.equal(!closed.ok && closed.code, 'publishing_unavailable')
  })

  it('the moderators are known by the admin key, and only by it', () => {
    assert.equal(isAdmin('Bearer s3cret-key', 's3cret-key'), true)
    assert.equal(isAdmin('Bearer s3cret-kez', 's3cret-key'), false)
    assert.equal(isAdmin('Bearer s3cret-key', undefined), false)
  })
})

// ── Publishing ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a person publishes under the name they chose', () => {
  it('chooses a name once, unique in the catalogue, then may change how it reads', async () => {
    const world = memoryStore()
    assert.deepEqual(dataOf(await whoAmI(world.store, anna)), { author: null, trusted: false })
    assert.equal(dataOf(await chooseName(world.store, anna, { name: 'Anna  Builds', url: 'https://anna.dev' })).author.id, 'anna-builds')
    assert.equal(codeOf(await chooseName(world.store, labs, { name: 'anna builds' })), 'name_taken')
    const renamed = dataOf(await chooseName(world.store, anna, { name: 'Anna Builds Things' }))
    assert.deepEqual(renamed.author, { id: 'anna-builds', name: 'Anna Builds Things', url: null })
    assert.equal(codeOf(await chooseName(world.store, anna, { name: 'x' })), 'invalid_name')
    assert.equal(codeOf(await chooseName(world.store, anna, { name: 'Anna', url: 'http://plain' })), 'invalid_url')
  })

  it('a name the catalogue had before (Agentivity Labs) is nobody\'s until Ops gives it', async () => {
    const world = memoryStore()
    world.authors.set('agentivity-labs', { author: { id: 'agentivity-labs', name: 'Agentivity Labs', url: 'https://agentivity.io' }, ownerPersonId: null })
    assert.equal(codeOf(await chooseName(world.store, labs, { name: 'Agentivity Labs' })), 'name_taken')
    dataOf(await giveAuthor(world.store, 'agentivity-labs', { personId: labs.personId }))
    assert.equal(dataOf(await whoAmI(world.store, labs)).author.name, 'Agentivity Labs')
    assert.equal(codeOf(await giveAuthor(world.store, 'agentivity-labs', { personId: '' })), 'person_required')
  })

  it('what is sent waits for review, under the person\'s name; approved, it is in the catalogue with its cover', async () => {
    const world = memoryStore()
    assert.equal(codeOf(await send(world, anna, template())), 'no_author_name')
    await chooseName(world.store, anna, { name: 'Anna Builds' })

    const sent = dataOf(await send(world, anna, template()))
    assert.equal(sent.status, 'pending')
    assert.equal(sent.summary.counts.solutions, 1)
    assert.equal(world.listed.size, 0)
    assert.equal(dataOf(await submissionsFor(world.store, null)).length, 1)

    const approved = dataOf(await approveSubmission(world.store, sent.id, 'moderator@agentivity.io'))
    assert.equal(approved.status, 'approved')
    const row = world.listed.get('service-desk')!.row!
    assert.equal(row.author_id, 'anna-builds')
    assert.equal(row.cover_url, 'https://cdn.example/service-desk.png')
    assert.equal((row.content as any).author.name, 'Anna Builds')
    assert.equal(codeOf(await approveSubmission(world.store, sent.id, 'moderator@agentivity.io')), 'not_pending')
  })

  it('a person Ops lets publish without review is in the catalogue at once', async () => {
    const world = memoryStore()
    await chooseName(world.store, labs, { name: 'Agentivity Labs' })
    const sent = dataOf(await send(world, labs, template()))
    assert.equal(sent.status, 'approved')
    assert.equal(sent.reviewedBy, 'published without review')
    assert.equal(world.listed.get('service-desk')!.status, 'published')
  })

  it('a refusal says why, and its author reads it with their Templates', async () => {
    const world = memoryStore()
    await chooseName(world.store, anna, { name: 'Anna Builds' })
    const sent = dataOf(await send(world, anna, template()))
    assert.equal(codeOf(await rejectSubmission(world.store, sent.id, 'moderator', { reason: '' })), 'reason_required')
    dataOf(await rejectSubmission(world.store, sent.id, 'moderator', { reason: 'The cover shows a real company logo.' }))
    const mine = dataOf(await myTemplates(world.store, anna))
    assert.deepEqual(mine.map((t: any) => [t.id, t.online, t.lastSent.status, t.lastSent.reason]), [['service-desk', null, 'rejected', 'The cover shows a real company logo.']])
  })

  it('an update waits for review while the version online stays; it must be newer, and a newer sending replaces the one waiting', async () => {
    const world = memoryStore()
    await chooseName(world.store, anna, { name: 'Anna Builds' })
    await approveSubmission(world.store, dataOf(await send(world, anna, template('service-desk', '1.0.0'))).id, 'moderator')

    assert.equal(codeOf(await send(world, anna, template('service-desk', '1.0.0'))), 'version_not_newer')
    const first = dataOf(await send(world, anna, template('service-desk', '1.1.0')))
    const second = dataOf(await send(world, anna, template('service-desk', '1.2.0')))
    assert.equal(world.listed.get('service-desk')!.version, '1.0.0')
    assert.equal(world.submissions.get(first.id)!.status, 'withdrawn')
    assert.equal(second.online.version, '1.0.0')

    const mine = dataOf(await myTemplates(world.store, anna))
    assert.deepEqual([mine[0].online, mine[0].lastSent.version, mine[0].lastSent.status], [{ version: '1.0.0', status: 'published' }, '1.2.0', 'pending'])
  })

  it('a Template id is its author\'s: another author cannot publish over it', async () => {
    const world = memoryStore()
    await chooseName(world.store, anna, { name: 'Anna Builds' })
    await chooseName(world.store, labs, { name: 'Agentivity Labs' })
    await send(world, anna, template())
    assert.equal(codeOf(await send(world, labs, template('service-desk', '2.0.0'))), 'id_taken')
  })

  it('a file that breaks the rules is refused with what to fix, and an upload of someone else is not found', async () => {
    const world = memoryStore()
    await chooseName(world.store, anna, { name: 'Anna Builds' })
    const broken = { ...template(), description: 'Too short' }
    const refused = await send(world, anna, broken)
    assert.equal(codeOf(refused), 'template_not_valid')

    const upload = await world.store.createUpload(labs.personId)
    world.files.set(upload.filePath, JSON.stringify(template()))
    assert.equal(codeOf(await submit(world.store, anna, { uploadId: upload.uploadId })), 'upload_not_found')
  })

  it('its author deletes it for good, out of the catalogue and of their Templates; nobody else; a moderator withdraws any', async () => {
    const world = memoryStore()
    await chooseName(world.store, anna, { name: 'Anna Builds' })
    await chooseName(world.store, labs, { name: 'Agentivity Labs' })
    await approveSubmission(world.store, dataOf(await send(world, anna, template())).id, 'moderator')
    assert.equal(codeOf(await deleteTemplate(world.store, labs, 'service-desk')), 'template_not_found')
    dataOf(await deleteTemplate(world.store, anna, 'service-desk'))
    assert.equal(world.listed.has('service-desk'), false)
    assert.deepEqual(dataOf(await myTemplates(world.store, anna)), [])
    // Its ID is free again.
    assert.equal(dataOf(await send(world, labs, template())).status, 'approved')

    world.listed.set('other', { slug: 'other', version: '1.0.0', name: 'Other', authorId: 'agentivity-labs', status: 'published' })
    dataOf(await withdrawTemplate(world.store, 'other'))
    assert.equal(world.listed.get('other')!.status, 'withdrawn')
  })

  it('versions compare as numbers, a pre-release before its release', () => {
    assert.equal(newerVersion('1.10.0', '1.9.9'), true)
    assert.equal(newerVersion('1.0.0', '1.0.0'), false)
    assert.equal(newerVersion('1.0.0', '1.0.0-beta'), true)
    assert.equal(newerVersion('1.0.0-beta', '1.0.0'), false)
    assert.equal(newerVersion('2.0.0', '10.0.0'), false)
  })
})

// ── Only the version online is kept ─────────────────────────────────────────────────────────────────────────────────────────

describe('the versions kept', () => {
  it('a version approved removes the approved ones before it, with their files; a refusal stays, with why', async () => {
    const world = memoryStore()
    await chooseName(world.store, anna, { name: 'Anna Builds' })
    const first = dataOf(await send(world, anna, template('service-desk', '1.0.0')))
    await approveSubmission(world.store, first.id, 'moderator')
    const refused = dataOf(await send(world, anna, template('service-desk', '1.1.0')))
    await rejectSubmission(world.store, refused.id, 'moderator', { reason: 'The cover shows a real company logo.' })
    const second = dataOf(await send(world, anna, template('service-desk', '1.2.0')))
    await approveSubmission(world.store, second.id, 'moderator')

    assert.deepEqual(dataOf(await submissionsFor(world.store, 'approved')).map((s: any) => s.version), ['1.2.0'])
    assert.equal(world.files.has(world.submissions.get(second.id)!.filePath), true)
    assert.equal(world.submissions.has(first.id), false)
    assert.equal(world.files.has(`${anna.personId}/${first.id}.template.json`), false)
    assert.equal(world.submissions.get(refused.id)!.status, 'rejected')
    assert.equal(world.listed.get('service-desk')!.version, '1.2.0')
  })

  it('the versions approved before this rule are removed at once, the one online kept', async () => {
    const world = memoryStore()
    await chooseName(world.store, labs, { name: 'Agentivity Labs' })
    for (const version of ['1.0.0', '1.0.1', '1.0.2']) dataOf(await send(world, labs, template('quote-desk', version)))
    // As it was before: three approved sendings of the same Template.
    world.submissions.set('old-1', { ...[...world.submissions.values()][0], id: 'old-1', version: '0.9.0' })

    assert.equal(dataOf(await pruneApproved(world.store)).removed, 1)
    assert.deepEqual([...world.submissions.values()].filter((s) => s.status === 'approved').map((s) => s.version), ['1.0.2'])
    assert.equal(dataOf(await pruneApproved(world.store)).removed, 0)
  })

  it('moderators read every Template of the catalogue, withdrawn ones too', async () => {
    const world = memoryStore()
    await chooseName(world.store, labs, { name: 'Agentivity Labs' })
    dataOf(await send(world, labs, template('service-desk')))
    dataOf(await send(world, labs, template('quote-desk')))
    dataOf(await withdrawTemplate(world.store, 'quote-desk'))

    // Both are named Service Desk here: their order is not what is checked.
    assert.deepEqual(dataOf(await catalogueForModerators(world.store)).map((t: any) => [t.id, t.version, t.status]).sort(), [['quote-desk', '1.0.0', 'withdrawn'], ['service-desk', '1.0.0', 'published']])
  })
})
