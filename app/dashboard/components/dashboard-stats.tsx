import {
    Users,
    Send,
    MessageSquare,
    TrendingUp
} from 'lucide-react'

export function DashboardStats({ campaigns }: { campaigns: any[] }) {
    // fast aggregation
    const totalSent = campaigns.reduce((acc, curr) => acc + (curr.sent_count || 0), 0)
    const totalRecipients = campaigns.reduce((acc, curr) => acc + (curr.recipients_count || 0), 0)
    const activeCampaigns = campaigns.filter(c => c.status === 'scheduled' || c.status === 'sending').length

    const stats = [
        {
            label: 'Total Sent',
            value: totalSent.toLocaleString(),
            subValue: 'Last 30 days',
            icon: Send,
            color: 'text-blue-600',
            bg: 'bg-blue-50 dark:bg-blue-900/20'
        },
        {
            label: 'Active Campaigns',
            value: activeCampaigns.toString(),
            subValue: 'Currently running',
            icon: TrendingUp,
            color: 'text-violet-600',
            bg: 'bg-violet-50 dark:bg-violet-900/20'
        },
        {
            label: 'Total Recipients',
            value: totalRecipients.toLocaleString(),
            subValue: 'Across all lists',
            icon: Users,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50 dark:bg-emerald-900/20'
        },
        {
            label: 'Avg. Reply Rate',
            value: '~12%', // Placeholder until global analytics API
            subValue: '+2.4% vs last month',
            icon: MessageSquare,
            color: 'text-amber-600',
            bg: 'bg-amber-50 dark:bg-amber-900/20'
        }
    ]

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((stat, i) => {
                const Icon = stat.icon
                return (
                    <div
                        key={i}
                        className="glass-card p-6 rounded-2xl border border-border/50 relative overflow-hidden group"
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                                <h3 className="text-2xl font-bold mt-2 text-foreground tracking-tight">{stat.value}</h3>
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
