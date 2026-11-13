import { apiSuccess, preflight } from '@/lib/api'

// GET /api/v1 — lists available v1 resources, so clients (Studio, the public site) have one discoverable entry point instead of
// hardcoding paths.
export async function GET() {
  return apiSuccess({
    version: 'v1',
    resources: {
      templates: '/api/v1/templates',
      template: '/api/v1/templates/{id}',
      templateFile: '/api/v1/templates/{id}/file',
      templateRoot: '/api/v1/templates/{id}/root',
      // Publishing, from a workspace (a person's token from accounts_service).
      me: '/api/v1/me',
      myUploads: '/api/v1/me/uploads',
      myTemplates: '/api/v1/me/templates',
    },
  })
}

export const OPTIONS = preflight
