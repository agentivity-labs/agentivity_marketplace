import { asModerator } from '@/lib/publishing-http'
import { submissionsFor } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

// GET /api/v1/admin/submissions?status=pending|approved|rejected|withdrawn — what waits for review (by default), oldest first.
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get('status')
  return asModerator(request, () => submissionsFor(publishing, status))
}
