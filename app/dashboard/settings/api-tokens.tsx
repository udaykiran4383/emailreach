'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { KeyRound, Copy, Trash2, Loader2 } from 'lucide-react'

interface ApiToken {
  id: string
  name: string
  token_prefix: string
  created_at: string
  last_used_at: string | null
}

/** Personal API tokens for the EmailReach MCP server (mcp/). */
export default function ApiTokens() {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Claude MCP')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await fetch('/api/api-tokens')
      if (res.ok) setTokens(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create token')
      setNewToken(data.token)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    const res = await fetch(`/api/api-tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) {
      setTokens((prev) => prev.filter((t) => t.id !== id))
      toast.success('Token revoked')
    } else {
      toast.error('Could not revoke token')
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          API tokens
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Let Claude (via the EmailReach MCP server in <code className="px-1 rounded bg-muted">mcp/</code>) list campaigns, find contacts
          and add recipients for you. Tokens can’t send email or touch your Gmail.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" className="sm:max-w-xs" />
        <Button onClick={create} disabled={creating}>
          {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create token
        </Button>
      </div>

      {newToken && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3 space-y-2">
          <p className="text-sm text-green-800 dark:text-green-200 font-medium">Copy this token now — it won’t be shown again.</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 break-all rounded bg-background p-2 text-xs">{newToken}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(newToken).then(() => toast.success('Copied'))}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  <code>{t.token_prefix}…</code> · created {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleString()}` : ' · never used'}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => revoke(t.id)} className="text-red-600 hover:text-red-700">
                <Trash2 className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
