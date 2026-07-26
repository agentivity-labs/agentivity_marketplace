import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Agentivity Marketplace API',
  description: 'REST API serving the Agentivity template catalog.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
