import DashboardClient from './dashboard-client'
import { getUser } from '@/lib/auth/actions'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  // Fetch real authenticated user
  const user = await getUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardClient userId={user.id} userEmail={user.email} />
    </div>
  )
}

