import { apiSuccess } from '@/lib/api'

// GET /api/v1 — lists available v1 resources, so clients (Studio, the public
// site) have one discoverable entry point instead of hardcoding paths.
export async function GET() {
  return apiSuccess({
    version: 'v1',
    resources: {
      templates: '/api/v1/templates',
      template: '/api/v1/templates/{slug}',
    },
  })
}
