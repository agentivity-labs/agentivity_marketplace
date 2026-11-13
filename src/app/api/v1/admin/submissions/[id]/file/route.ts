import { asModerator } from '@/lib/publishing-http'
import { submissionFile } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

interface Params {
  params: Promise<{ id: string }>
}

// GET /api/v1/admin/submissions/{id}/file — the file sent, as it is, for the moderator to read before deciding.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params
  return asModerator(request, () => submissionFile(publishing, id))
}
