'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
    RefreshCw,
    AlertOctagon,
    AlertTriangle,
    ShieldAlert,
    Search
} from 'lucide-react'

interface Recipient {
    id?: string
    email: string
    name?: string
    company?: string
    status?: string
    error_message?: string
}

export default function SkippedRecipients({ campaignId }: { campaignId: string }) {
    const [recipients, setRecipients] = useState<Recipient[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchRecipients()
    }, [campaignId])

    const fetchRecipients = async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/campaigns/${campaignId}/recipients?t=${Date.now()}`, {
                cache: 'no-store'
            })
            if (res.ok) {
                const data = await res.json()
                // Filter ONLY skipped emails
                const skipped = data.filter((r: Recipient) => r.error_message?.startsWith('Skipped'))
                setRecipients(skipped)
            }
        } catch (error) {
            console.error('Failed to fetch recipients')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-6">
                <div className="flex items-start gap-4">
                    <div className="p-3 bg-amber-100 rounded-lg">
                        <ShieldAlert className="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-amber-900">Verification Issues</h3>
                        <p className="text-amber-700 mt-1 max-w-3xl">
                            These emails were skipped during the sending process because they failed verification checks.
                            This protects your domain reputation by preventing bounces from invalid or risky addresses.
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/50 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-100">
                            <AlertTriangle className="w-4 h-4 text-amber-700" />
                        </div>
                        <h3 className="font-semibold text-foreground">
                            {recipients.length} Skipped Recipients
                        </h3>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchRecipients}
                        disabled={loading}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-muted/30">
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reason</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                                        Loading...
                                    </td>
                                </tr>
                            ) : recipients.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center">
                                        <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                                            <CheckCircle2 className="w-6 h-6 text-green-600" />
                                        </div>
                                        <p className="text-muted-foreground font-medium">No skipped emails found</p>
                                        <p className="text-sm text-muted-foreground mt-1">All recipients passed verification checks</p>
                                    </td>
                                </tr>
                            ) : (
                                recipients.map((recipient, index) => {
                                    const isRisky = recipient.error_message?.includes('Risky')
                                    return (
                                        <tr key={recipient.id || index} className="border-b border-border hover:bg-muted/30 transition-colors">
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${isRisky ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                                                    }`}>
                                                    {isRisky ? <AlertTriangle className="w-3 h-3" /> : <AlertOctagon className="w-3 h-3" />}
                                                    {isRisky ? 'Risky' : 'Invalid'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                                                {recipient.error_message?.replace('Skipped - ', '')}
                                            </td>
                                            <td className="px-6 py-4 text-sm font-medium text-foreground">{recipient.email}</td>
                                            <td className="px-6 py-4 text-sm text-muted-foreground">{recipient.name || '—'}</td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

function CheckCircle2(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    )
}
