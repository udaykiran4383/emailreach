import { verifyResumeToken, recordResumeView } from '@/lib/resume-links'
import { downloadResume } from '@/lib/storage/resume'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function notFound() {
  return new Response('This link is invalid or has expired.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** Public, tracked resume link: logs the view, then serves the PDF inline. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const parsed = verifyResumeToken(token)
  if (!parsed) return notFound()

  try {
    const link = await recordResumeView(parsed.linkId, parsed.recipientId, request.headers.get('user-agent') || '')
    if (!link) return notFound()

    const resume = await downloadResume(link.storage_path)
    if (!resume) return notFound()

    const filename = (link.filename || resume.filename).replace(/["\r\n]/g, '')
    return new Response(new Uint8Array(resume.content), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(resume.content.length),
        'Cache-Control': 'no-store, private',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (err: any) {
    console.error('[resume-link] Error:', err?.message || err)
    return notFound()
  }
}
