'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Inbox,
  Loader2,
  RefreshCw,
  ExternalLink,
  CalendarCheck,
  Share2,
  FileText,
  ThumbsUp,
  Ban,
  XCircle,
  Plane,
  MailX,
  Bot,
  HelpCircle,
} from 'lucide-react'

interface Reply {
  id: string
  campaignId: string
  campaignName: string
  threadId: string | null
  subject: string
  from: string
  snippet: string
  receivedAt: string
  classification: string
  classificationReason: string
  classifiedBy: 'ai' | 'rules' | null
  returnDate: string | null
  recipient: { id: string; name: string; email: string; company: string | null; status: string } | null
}

const CATEGORIES: Record<string, { label: string; icon: typeof Inbox; className: string }> = {
  interview_request: { label: 'Interview request', icon: CalendarCheck, className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  referral: { label: 'Referral', icon: Share2, className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300' },
  send_resume: { label: 'Send resume', icon: FileText, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  interested: { label: 'Interested', icon: ThumbsUp, className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
  not_hiring: { label: 'Not hiring', icon: Ban, className: 'bg-gray-200 text-gray-800 dark:bg-gray-800 dark:text-gray-300' },
  rejection: { label: 'Rejection', icon: XCircle, className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  out_of_office: { label: 'Out of office', icon: Plane, className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  unsubscribe: { label: 'Unsubscribe', icon: MailX, className: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
  auto_reply_other: { label: 'Auto reply', icon: Bot, className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  other: { label: 'Other', icon: HelpCircle, className: 'bg-muted text-muted-foreground' },
  unclassified: { label: 'Unclassified', icon: HelpCircle, className: 'bg-muted text-muted-foreground' },
}

// Most actionable first
const ORDER = ['interview_request', 'send_resume', 'referral', 'interested', 'out_of_office', 'not_hiring', 'rejection', 'unsubscribe', 'auto_reply_other', 'other', 'unclassified']

function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORIES[category] || CATEGORIES.other
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${meta.className}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}

export default function RepliesPage() {
  const [replies, setReplies] = useState<Reply[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReplies()
  }, [])

  const fetchReplies = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/replies', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setReplies(data.replies)
        setCounts(data.counts)
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
    }
  }

  const groups = useMemo(() => {
    const visible = filter ? replies.filter(r => r.classification === filter) : replies
    const byCategory = new Map<string, Reply[]>()
    for (const r of visible) {
      const list = byCategory.get(r.classification) || []
      list.push(r)
      byCategory.set(r.classification, list)
    }
    return ORDER.filter(c => byCategory.has(c)).map(c => ({ category: c, replies: byCategory.get(c)! }))
  }, [replies, filter])

  const actionable = (counts.interview_request || 0) + (counts.send_resume || 0) + (counts.referral || 0)

  return (
    <div className="flex flex-col gap-8 py-8 animate-enter">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Inbox className="w-7 h-7 text-primary" />
            Replies
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Every reply to your campaigns, sorted by what it needs from you.
          </p>
        </div>
        <Button variant="outline" onClick={fetchReplies} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total replies</p>
          <p className="text-3xl font-bold mt-2">{total}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Need action</p>
          <p className="text-3xl font-bold mt-2 text-green-600">{actionable}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Interviews</p>
          <p className="text-3xl font-bold mt-2">{counts.interview_request || 0}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Out of office</p>
          <p className="text-3xl font-bold mt-2 text-amber-600">{counts.out_of_office || 0}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${filter === null ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          All ({total})
        </button>
        {ORDER.filter(c => counts[c]).map(c => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${filter === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          >
            {CATEGORIES[c]?.label || c} ({counts[c]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 glass-panel rounded-2xl">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground font-medium">Loading replies...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 glass-panel rounded-2xl border-dashed text-center">
          <Inbox className="w-10 h-10 text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No replies yet</h3>
          <p className="text-muted-foreground max-w-md">
            Replies appear here after a sync (the "Sync Status" button on a campaign, or the background scheduler).
          </p>
        </div>
      ) : (
        groups.map(group => (
          <section key={group.category} className="space-y-3">
            <div className="flex items-center gap-2">
              <CategoryBadge category={group.category} />
              <span className="text-sm text-muted-foreground">{group.replies.length}</span>
            </div>
            <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
              {group.replies.map(r => (
                <div key={r.id} className="p-4 flex flex-col md:flex-row md:items-start gap-3 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="font-semibold text-foreground truncate">{r.recipient?.name || r.from}</p>
                      {r.recipient?.company && <p className="text-sm text-muted-foreground">{r.recipient.company}</p>}
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.receivedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <p className="text-sm font-medium mt-1 truncate">{r.subject || '(no subject)'}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.snippet}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {r.classificationReason}
                      {r.returnDate && ` · back ${new Date(`${r.returnDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, follow-up waits until then`}
                      {r.classifiedBy && ` · sorted by ${r.classifiedBy === 'ai' ? 'AI' : 'keyword rules'}`}
                      {' · '}
                      <Link href={`/dashboard/campaigns/${r.campaignId}`} className="hover:underline">
                        {r.campaignName}
                      </Link>
                    </p>
                  </div>
                  {r.threadId && (
                    <a
                      href={`https://mail.google.com/mail/u/0/#inbox/${r.threadId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline shrink-0"
                    >
                      Open in Gmail
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
