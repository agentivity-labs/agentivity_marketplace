export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 40, maxWidth: 680 }}>
      <h1>Agentivity Marketplace API</h1>
      <p>This service has no UI — it's a REST API for the Templates (a use case in one file). Start here:</p>
      <ul>
        <li>
          <code>GET /api/v1</code> — discover available resources
        </li>
        <li>
          <code>GET /api/v1/templates</code> — list the Templates (<code>q</code>, <code>tag</code>, <code>language</code>,{' '}
          <code>author</code>, <code>limit</code>, <code>offset</code>)
        </li>
        <li>
          <code>GET /api/v1/templates/{'{id}'}</code> — one Template: summary, contents, requirements
        </li>
        <li>
          <code>GET /api/v1/templates/{'{id}'}/file</code> — download the Template file
        </li>
        <li>
          <code>GET /api/v1/templates/{'{id}'}/root</code> — what is needed to draw its graph
        </li>
      </ul>
    </main>
  )
}
