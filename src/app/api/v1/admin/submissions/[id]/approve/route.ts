import { asModerator } from '@/lib/publishing-http'
import { approveSubmission } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/v1/admin/submissions/{id}/approve — puts it in the catalogue, under its author's name.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  return asModerator(request, (reviewer) => approveSubmission(publishing, id, reviewer))
}
