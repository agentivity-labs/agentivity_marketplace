import { asPerson } from '@/lib/publishing-http'
import { unpublish } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/v1/me/templates/{id}/unpublish — takes one of the person's Templates out of the catalogue, with what waits for review.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  return asPerson(request, (publisher) => unpublish(publishing, publisher, id))
}
