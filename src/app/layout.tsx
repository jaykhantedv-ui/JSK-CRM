import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'JSK CRM',
  description: 'Sales CRM for a building-materials retailer.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/* §12.1 — Inter or system stack. The system stack is used until a font decision is taken. */}
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
