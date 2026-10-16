'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FileText, Link2, Loader2, RefreshCw, Eye, Paperclip, Copy } from 'lucide-react'

interface Viewer {
  recipientId: string | null
  email: string | null
  name: string | null
  views: number
  firstViewedAt: string
  lastViewedAt: string
}

interface Stats {
  enabled: boolean
  hasResume: boolean
  publicBase: boolean
  attachResume: boolean
  previewUrl?: string | null
  totalViews?: number
  uniqueViewers?: number
  viewers?: Viewer[]
}

export default function ResumeLinkCard({ campaignId, lastSync }: { campaignId: string; lastSync?: number }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)

  const call = async (action: 'enable' | 'disable' | 'stats') => {
    const res = await fetch('/api/resume-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }

  const load = async () => {
    try {
      setStats(await call('stats'))
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [campaignId, lastSync])

  const enable = async () => {
    setWorking(true)
    try {
      const data = await call('enable')
      toast.success(`Resume link added for ${data.updated} recipients`, {
        description: 'Put {{resume_url}} in your email body. The PDF is no longer attached.',
      })
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setWorking(false)
    }
  }

  const disable = async () => {
    setWorking(true)
    try {
      await call('disable')
      toast.success('The PDF will be attached again')
      await load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg gradient-primary">
            <Link2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Resume link</h3>
            <p className="text-sm text-muted-foreground">
              Send a tracked link instead of attaching your PDF.
            </p>
          </div>
        </div>
        {stats?.hasResume && (
          stats.enabled ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={enable} disabled={working}>
                <RefreshCw className={`w-4 h-4 mr-2 ${working ? 'animate-spin' : ''}`} />
                Update for new recipients
              </Button>
              <Button variant="ghost" size="sm" onClick={disable} disabled={working}>
                <Paperclip className="w-4 h-4 mr-2" />
                Attach PDF instead
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={enable} disabled={working || !stats.publicBase}>
              {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
              Use resume link
            </Button>
          )
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Attachments on a first cold email are a strong spam signal. A link keeps the email light, and you can see
        who actually opened your resume. Put <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono">{'{{resume_url}}'}</code> in
        your email body where the link should go.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : !stats?.hasResume ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <FileText className="w-4 h-4" /> This campaign has no resume uploaded.
        </p>
      ) : !stats.publicBase ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Set <code className="px-1 rounded bg-muted">NEXT_PUBLIC_SITE_URL</code> to your public site URL first — recipients can’t open
          links that point to localhost.
        </p>
      ) : stats.enabled ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Eye className="w-4 h-4 text-primary" />
              {stats.uniqueViewers ?? 0} people viewed · {stats.totalViews ?? 0} views
            </span>
            {stats.previewUrl && (
              <button
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(stats.previewUrl!).then(() => toast.success('Untracked link copied'))
                }}
              >
                <Copy className="w-3 h-3" /> Copy a general link (not tied to a recipient)
              </button>
            )}
          </div>
          {(stats.viewers?.length ?? 0) > 0 && (
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Who</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Views</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase">Last viewed</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.viewers!.map((v) => (
                    <tr key={v.recipientId || 'unknown'} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        {v.recipientId ? (
                          <>
                            <p className="font-medium">{v.name || v.email}</p>
                            {v.name && <p className="text-xs text-muted-foreground">{v.email}</p>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">Shared / general link</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-semibold">{v.views}</td>
                      <td className="px-4 py-2 text-muted-foreground">{new Date(v.lastViewedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Link scanners and email previews are filtered out of these counts.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Currently the PDF is attached to every email.</p>
      )}
    </div>
  )
}
