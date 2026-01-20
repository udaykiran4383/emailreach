import { redirect } from 'next/navigation'

export default async function Home() {
  // Direct redirect to dashboard - no auth for personal job application tool
  redirect('/dashboard')
}

