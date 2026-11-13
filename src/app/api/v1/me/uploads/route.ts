import { asPerson } from '@/lib/publishing-http'
import { startUpload } from '@/lib/publishing'
import { publishing } from '@/lib/publishing-repo'

// POST /api/v1/me/uploads — { uploadId, uploadUrl }: where the workspace PUTs the Template file, straight to the storage; then
// POST /api/v1/me/templates { uploadId } publishes it.
export async function POST(request: Request) {
  return asPerson(request, (publisher) => startUpload(publishing, publisher))
}
