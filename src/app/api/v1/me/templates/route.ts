import { asPerson, bodyOf } from '@/lib/publishing-http'
import { myTemplates, submit } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

// GET /api/v1/me/templates — the person's Templates: the version online, and what became of the last one sent (reason if refused).
export async function GET(request: Request) {
  return asPerson(request, (publisher) => myTemplates(publishing, publisher))
}

// POST /api/v1/me/templates — { uploadId }: publishes the file sent there. It waits for a moderator, unless Ops lets the person
// publish without review; an update waits the same way while the version online stays.
export async function POST(request: Request) {
  const body = await bodyOf(request)
  return asPerson(request, (publisher) => submit(publishing, publisher, body))
}
