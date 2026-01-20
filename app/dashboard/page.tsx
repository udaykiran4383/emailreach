import DashboardClient from './dashboard-client'

export default async function DashboardPage() {
  // Personal job application tool - no auth needed
  // Hardcoded user info for direct access
  const userId = 'personal-user'
  const userEmail = 'udayyennampelly0@gmail.com'

  return (
    <div className="min-h-screen bg-background">
      <DashboardClient userId={userId} userEmail={userEmail} />
    </div>
  )
}

