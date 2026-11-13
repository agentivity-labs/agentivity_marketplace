import { asModerator } from '@/lib/publishing-http'
import { withdrawTemplate } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/v1/admin/templates/{id}/withdraw — takes any Template out of the catalogue.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  return asModerator(request, () => withdrawTemplate(publishing, id))
}
