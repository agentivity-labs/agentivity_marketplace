import { asModerator } from '@/lib/publishing-http'
import { catalogueForModerators } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

// GET /api/v1/admin/templates — every Template of the catalogue, published or withdrawn: [{ id, name, version, authorId, status }].
export async function GET(request: Request) {
  return asModerator(request, () => catalogueForModerators(publishing))
}
