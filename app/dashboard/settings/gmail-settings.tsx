'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface GmailCredential {
  id: string
  email: string
  created_at: string
}

export default function GmailSettings({ userId }: { userId: string }) {
  const [credentials, setCredentials] = useState<GmailCredential[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCredentials()
  }, [])

  const fetchCredentials = async () => {
    try {
      const response = await fetch('/api/gmail/credentials')
      if (response.ok) {
        const data = await response.json()
        setCredentials(data)
      }
    } catch (error) {
      console.error('Error fetching credentials:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleConnect = () => {
    // Redirect to Gmail OAuth flow
    window.location.href = '/api/gmail/auth'
  }

  const handleDisconnect = async (credentialId: string) => {
    try {
      const response = await fetch(`/api/gmail/credentials/${credentialId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setCredentials(credentials.filter((c) => c.id !== credentialId))
      }
    } catch (error) {
      console.error('Error disconnecting Gmail:', error)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Gmail Account</h2>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : credentials.length === 0 ? (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Connect your Gmail account to start sending emails from your outreach campaigns.
            </p>
            <Button
              onClick={handleConnect}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Connect Gmail Account
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {credentials.map((cred) => (
              <div
                key={cred.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/50"
              >
                <div>
                  <p className="font-medium text-foreground">{cred.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Connected on {new Date(cred.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDisconnect(cred.id)}
                  className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                >
                  Disconnect
                </Button>
              </div>
            ))}
            <Button
              onClick={handleConnect}
              variant="outline"
              className="w-full bg-transparent"
            >
              Add Another Gmail Account
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
