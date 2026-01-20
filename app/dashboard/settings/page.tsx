import GmailSettings from './gmail-settings'
import { getUser } from '@/lib/auth/actions'
import { redirect } from 'next/navigation'

export default async function SettingsPage() {
  const user = await getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-foreground mb-8">Gmail Settings</h1>
        <GmailSettings userId={user.id} />
      </div>
    </div>
  )
}

