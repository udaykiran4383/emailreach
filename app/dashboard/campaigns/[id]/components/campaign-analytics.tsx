'use client'

import { useEffect, useState } from 'react'
import {
  Send,
  AlertCircle,
  MessageCircle,
  TrendingUp,
  Loader2,
  CheckCircle2,
  XCircle,
  BarChart3
} from 'lucide-react'

interface Analytics {
  totalSent: number
  totalFailed: number
  totalReplies: number
  openRate: string
  failureRate: string
  logs: Array<{
    id: string
    email: string
    name?: string
    status: 'sent' | 'failed'
    sentAt: string
    replied: boolean
    replyContent?: string
  }>
}

export default function CampaignAnalytics({ campaignId }: { campaignId: string }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAnalytics()
  }, [campaignId])

  const fetchAnalytics = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/analytics`)
      if (response.ok) {
        const data = await response.json()
        setAnalytics(data)
      }
    } catch (error) {
      console.error('Error fetching analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-6">
              <div className="skeleton h-4 w-20 rounded mb-3" />
              <div className="skeleton h-8 w-16 rounded" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          <BarChart3 className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">No analytics data available yet</p>
        <p className="text-sm text-muted-foreground mt-1">Send your campaign to see results here</p>
      </div>
    )
  }

  const metrics = [
    {
      label: 'Total Sent',
      value: analytics.totalSent,
      icon: Send,
      gradient: 'from-blue-500 to-indigo-600',
      bgLight: 'bg-blue-50',
      textColor: 'text-blue-600'
    },
    {
      label: 'Total Failed',
      value: analytics.totalFailed,
      icon: AlertCircle,
      gradient: 'from-red-500 to-rose-600',
      bgLight: 'bg-red-50',
      textColor: 'text-red-600'
    },
    {
      label: 'Replies',
      value: analytics.totalReplies,
      icon: MessageCircle,
      gradient: 'from-green-500 to-emerald-600',
      bgLight: 'bg-green-50',
      textColor: 'text-green-600'
    },
    {
      label: 'Reply Rate',
      value: `${analytics.openRate}%`,
      icon: TrendingUp,
      gradient: 'from-violet-500 to-purple-600',
      bgLight: 'bg-violet-50',
      textColor: 'text-violet-600'
    },
  ]

  return (
    <div className="space-y-6">
      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map((metric, index) => {
          const Icon = metric.icon
          return (
            <div
              key={metric.label}
              className="bg-card border border-border rounded-xl p-6 card-hover"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-lg ${metric.bgLight}`}>
                  <Icon className={`w-4 h-4 ${metric.textColor}`} />
                </div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {metric.label}
                </p>
              </div>
              <p className={`text-3xl font-bold ${metric.textColor}`}>
                {metric.value}
              </p>
            </div>
          )
        })}
      </div>

      {/* Detailed Log */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50">
          <h3 className="font-semibold text-foreground">Send History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Sent
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Reply
                </th>
              </tr>
            </thead>
            <tbody>
              {analytics.logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    No send history yet
                  </td>
                </tr>
              ) : (
                analytics.logs.map((log, index) => (
                  <tr
                    key={log.id}
                    className="border-b border-border hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm text-foreground font-medium">{log.email}</td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${log.status === 'sent'
                            ? 'badge-success'
                            : 'bg-red-100 text-red-800'
                          }`}
                      >
                        {log.status === 'sent' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <XCircle className="w-3 h-3" />
                        )}
                        {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {new Date(log.sentAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {log.replied ? (
                        <span className="inline-flex items-center gap-1.5 text-green-600 font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
