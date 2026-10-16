/**
 * Next.js instrumentation hook. A complete no-op outside end-to-end test runs: only when E2E_MODE=1
 * (and never in production) does it route Google API calls and fixture sites to local mock servers,
 * so the e2e suite never sends real email.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.E2E_MODE !== '1' || process.env.NODE_ENV === 'production') return
  if (!process.env.GMAIL_API_ROOT_URL && !process.env.E2E_SITES_URL) return
  const { installE2eNetworkMocks } = await import('./lib/e2e/network-mocks')
  installE2eNetworkMocks()
}
