import { asModerator, bodyOf } from '@/lib/publishing-http'
import { giveAuthor } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// PUT /api/v1/admin/authors/{id}/owner — { personId }: gives an author name to a person (Agentivity Labs to its founder).
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params
  const body = await bodyOf(request)
  return asModerator(request, () => giveAuthor(publishing, id, body))
}
