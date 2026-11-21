import { asModerator } from '@/lib/publishing-http'
import { pruneApproved } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

// POST /api/v1/admin/submissions/prune — removes the approved sendings older than the version online of each Template, with
// their files; refused and withdrawn ones stay. { removed }.
export async function POST(request: Request) {
  return asModerator(request, () => pruneApproved(publishing))
}
