'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Upload,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Users,
  Loader2,
  AlertCircle
} from 'lucide-react'

interface Recipient {
  id?: string
  email: string
  name?: string
  company?: string
  status?: 'pending' | 'sent' | 'replied' | 'failed' | 'skipped'
  error_message?: string
  follow_up_sent?: boolean
}

export default function RecipientUpload({ campaignId, lastSync }: { campaignId: string, lastSync?: number }) {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchRecipients()
  }, [campaignId, lastSync])

  const fetchRecipients = async () => {
    try {
      // Add timestamp to prevent caching
      const res = await fetch(`/api/campaigns/${campaignId}/recipients?t=${Date.now()}`, {
        cache: 'no-store'
      })
      if (res.ok) {
        const data = await res.json()
        setRecipients(data)
      }
    } catch (error) {
      console.error('Failed to fetch recipients')
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)

    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/)
      const newRecipients: Recipient[] = []

      const firstLine = lines[0]?.toLowerCase()
      const hasHeader = firstLine && (firstLine.includes('email') || firstLine.includes('name') || firstLine.includes('company'))

      let emailIdx = 0
      let nameIdx = 1
      let companyIdx = 2

      let startIdx = 0

      if (hasHeader) {
        startIdx = 1
        const headers = lines[0].toLowerCase().split(/[,\t]/).map(h => h.trim().replace(/^"|"$/g, ''))

        emailIdx = headers.findIndex(h => h.includes('email'))
        nameIdx = headers.findIndex(h => h.includes('name'))
        companyIdx = headers.findIndex(h => h.includes('company'))

        if (emailIdx === -1) emailIdx = 0
      }

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) continue

        const parts = line.split(/[,\t]/).map((p) => p.trim().replace(/^"|"$/g, ''))

        const email = parts[emailIdx]

        if (email && email.includes('@')) {
          newRecipients.push({
            email: email,
            name: nameIdx !== -1 ? parts[nameIdx] || '' : '',
            company: companyIdx !== -1 ? parts[companyIdx] || '' : '',
          })
        }
      }

      const response = await fetch(`/api/campaigns/${campaignId}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: newRecipients }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save recipients')
      }

      if (data.errors && data.errors.length > 0) {
        alert(`Uploaded ${data.count} recipients with some errors:\n${data.errors.join('\n')}`)
      } else {
        alert(`Successfully uploaded ${data.count} recipients!`)
      }

      fetchRecipients()

    } catch (error: any) {
      console.error('Error uploading file:', error)
      alert(`Error uploading file: ${error.message}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const getStatusBadge = (status?: string, error?: string) => {
    switch (status) {
      case 'replied':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium badge-success">
            <CheckCircle2 className="w-3 h-3" />
            Replied
          </span>
        )
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium badge-success">
            <Send className="w-3 h-3" />
            Sent
          </span>
        )
      case 'failed':
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              <XCircle className="w-3 h-3" />
              Failed
            </span>
            {error && <span className="text-[10px] text-red-600 max-w-[150px] truncate" title={error}>{error}</span>}
          </div>
        )
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium badge-warning">
            <AlertCircle className="w-3 h-3" />
            Skipped
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <div
        className="relative bg-card border-2 border-dashed border-primary/30 rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors group"
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="absolute inset-0 gradient-primary opacity-0 group-hover:opacity-5 rounded-xl transition-opacity" />
        <div className="relative">
          <div className="mx-auto w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mb-4">
            {uploading ? (
              <Loader2 className="w-7 h-7 text-white animate-spin" />
            ) : (
              <Upload className="w-7 h-7 text-white" />
            )}
          </div>
          <p className="text-foreground font-semibold mb-1">
            {uploading ? 'Uploading...' : 'Upload Recipients'}
          </p>
          <p className="text-muted-foreground text-sm mb-4">
            Drop a CSV file or click to browse
          </p>
          <p className="text-xs text-muted-foreground">
            Columns: <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono">email</code>,{' '}
            <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono">name</code>,{' '}
            <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono">company</code>
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={handleFileUpload}
          disabled={uploading}
          className="hidden"
        />
      </div>

      {/* Recipients Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg gradient-primary">
              <Users className="w-4 h-4 text-white" />
            </div>
            <h3 className="font-semibold text-foreground">
              {recipients.length} Recipients
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
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Replied?</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Follow-up?</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Company</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="px-6 py-4"><div className="skeleton h-6 w-20 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="skeleton h-6 w-12 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="skeleton h-6 w-12 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="skeleton h-4 w-24 rounded" /></td>
                    <td className="px-6 py-4"><div className="skeleton h-4 w-40 rounded" /></td>
                    <td className="px-6 py-4"><div className="skeleton h-4 w-28 rounded" /></td>
                  </tr>
                ))
              ) : recipients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-3">
                      <Users className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground font-medium">No recipients yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Upload a CSV file to add recipients</p>
                  </td>
                </tr>
              ) : (
                recipients.map((recipient, index) => (
                  <tr key={recipient.id || index} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">{getStatusBadge(recipient.status, recipient.error_message)}</td>
                    <td className="px-6 py-4">
                      {recipient.status === 'replied' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <XCircle className="w-3 h-3" />
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {recipient.follow_up_sent ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          <Clock className="w-3 h-3" />
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-foreground">{recipient.name || '—'}</td>
                    <td className="px-6 py-4 text-sm text-foreground">{recipient.email}</td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">{recipient.company || '—'}</td>
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
