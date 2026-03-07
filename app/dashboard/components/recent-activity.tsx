'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Mail, MessageSquare, RefreshCcw } from 'lucide-react'

interface ActivityLog {
    id: string
    event_type: 'sent' | 'reply' | 'follow_up'
    email: string
    campaign_name: string
    timestamp: string
    metadata?: any
}

export default function RecentActivity() {
    const [logs, setLogs] = useState<ActivityLog[]>([])
    const [loading, setLoading] = useState(true)

    const fetchActivity = async () => {
        try {
            // We'll use a new API route for this, or simulate for now if route doesn't exist
            // Let's create a dedicated route for global activity across campaigns
            const response = await fetch('/api/dashboard/activity')
            if (response.ok) {
                const data = await response.json()
                setLogs(data)
            }
        } catch (error) {
            console.error('Error fetching activity:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchActivity()
        // Poll every 30 seconds for specific "live" feel
        const interval = setInterval(fetchActivity, 30000)
        return () => clearInterval(interval)
    }, [])

    if (loading) {
        return (
            <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-4 items-start animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-muted" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 w-3/4 bg-muted rounded" />
                            <div className="h-3 w-1/4 bg-muted rounded" />
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    if (logs.length === 0) {
        return (
            <div className="text-center py-8 text-muted-foreground text-sm">
                No recent activity
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Recent Activity</h3>
                <button
                    onClick={() => { setLoading(true); fetchActivity(); }}
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                >
                    <RefreshCcw className="w-3 h-3" /> Refresh
                </button>
            </div>

            <div className="relative border-l border-border ml-3 space-y-6 pb-2">
                {logs.map((log, index) => {
                    let Icon = Mail
                    let colorClass = "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                    let title = "Email Sent"

                    if (log.event_type === 'reply') {
                        Icon = MessageSquare
                        colorClass = "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                        title = "Reply Received"
                    } else if (log.event_type === 'follow_up') {
                        Icon = CheckCircle2
                        colorClass = "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
                        title = "Follow-up Sent"
                    }

                    return (
                        <div key={log.id} className="relative pl-8 group">
                            <div className={`absolute -left-[17px] p-1.5 rounded-full border-2 border-background ${colorClass}`}>
                                <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="bg-card/50 p-3 rounded-lg border border-border/50 hover:bg-card hover:border-primary/20 transition-all">
                                <div className="flex justify-between items-start">
                                    <p className="text-sm font-medium">{title}</p>
                                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    To: <span className="font-medium text-foreground">{log.email}</span>
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-1 truncate opacity-80">
                                    {log.campaign_name}
                                </p>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
