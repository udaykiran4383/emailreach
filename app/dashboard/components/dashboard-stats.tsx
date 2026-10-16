import {
    Send,
    MessageSquare,
    MailOpen,
    TrendingUp
} from 'lucide-react'
import type { DashboardSummary } from './home/types'

export function DashboardStats({
    totals,
    activeCampaigns,
}: {
    totals: DashboardSummary['totals']
    activeCampaigns: number
}) {
    const stats = [
        {
            label: 'Sent',
            value: totals.sent30.toLocaleString(),
            subValue: 'Last 30 days',
            icon: Send,
            color: 'text-blue-600',
            bg: 'bg-blue-50 dark:bg-blue-900/20'
        },
        {
            label: 'Reply Rate',
            value: totals.replyRate === null ? '—' : `${totals.replyRate}%`,
            subValue: `${totals.replied30} replies in 30 days`,
            icon: MessageSquare,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50 dark:bg-emerald-900/20'
        },
        {
            label: 'Open Rate',
            value: totals.openRate === null ? '—' : `${totals.openRate}%`,
            subValue: 'Approximate, tracked campaigns only',
            icon: MailOpen,
            color: 'text-amber-600',
            bg: 'bg-amber-50 dark:bg-amber-900/20'
        },
        {
            label: 'Active Campaigns',
            value: activeCampaigns.toString(),
            subValue: `${totals.campaigns} total · ${totals.recipients.toLocaleString()} recipients`,
            icon: TrendingUp,
            color: 'text-violet-600',
            bg: 'bg-violet-50 dark:bg-violet-900/20'
        },
    ]

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat) => {
                const Icon = stat.icon
                return (
                    <div
                        key={stat.label}
                        className="glass-card p-6 rounded-2xl border border-border/50 relative overflow-hidden group"
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                                <h3 className="text-2xl font-bold mt-2 text-foreground tracking-tight tabular-nums">{stat.value}</h3>
                                <p className="text-xs text-muted-foreground mt-1">{stat.subValue}</p>
                            </div>
                            <div className={`p-3 rounded-xl ${stat.bg} transition-transform duration-300 group-hover:scale-110`}>
                                <Icon className={`w-5 h-5 ${stat.color}`} />
                            </div>
                        </div>

                        {/* Hover Glow Effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                    </div>
                )
            })}
        </div>
    )
}
