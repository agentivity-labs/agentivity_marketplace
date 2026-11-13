import { asModerator, bodyOf } from '@/lib/publishing-http'
import { rejectSubmission } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// POST /api/v1/admin/submissions/{id}/reject — { reason }: refuses it; its author reads the reason in their workspace.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const body = await bodyOf(request)
  return asModerator(request, (reviewer) => rejectSubmission(publishing, id, reviewer, body))
}
