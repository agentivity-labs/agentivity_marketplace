import { asPerson } from '@/lib/publishing-http'
import { deleteTemplate } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// DELETE /api/v1/me/templates/{id} — deletes one of the person's Templates for good: out of the catalogue and of their Templates, its
// cover and what they sent of it. Those who imported it keep their copy; its ID is free again.
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params
  return asPerson(request, (publisher) => deleteTemplate(publishing, publisher, id))
}
