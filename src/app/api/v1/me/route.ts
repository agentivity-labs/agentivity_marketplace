import { asPerson, bodyOf } from '@/lib/publishing-http'
import { chooseName, whoAmI } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

// GET /api/v1/me — the name the person publishes under (null until they choose one) and whether they publish without review.
export async function GET(request: Request) {
  return asPerson(request, (publisher) => whoAmI(publishing, publisher))
}

// PUT /api/v1/me — { name, url? }: chooses, or changes, the name they publish under (unique in the catalogue).
export async function PUT(request: Request) {
  const body = await bodyOf(request)
  return asPerson(request, (publisher) => chooseName(publishing, publisher, body))
}
