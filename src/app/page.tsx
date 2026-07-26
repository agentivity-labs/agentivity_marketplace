export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 40, maxWidth: 640 }}>
      <h1>Agentivity Marketplace API</h1>
      <p>This service has no UI — it's a REST API. Start here:</p>
      <ul>
        <li>
          <code>GET /api/v1</code> — discover available resources
        </li>
        <li>
          <code>GET /api/v1/templates</code> — list templates (<code>q</code>, <code>kind</code>,{' '}
          <code>department</code>, <code>limit</code>, <code>offset</code>)
        </li>
        <li>
          <code>GET /api/v1/templates/{'{slug}'}</code> — full template, including downloadable content
        </li>
      </ul>
    </main>
  )
}
