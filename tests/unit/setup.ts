// Several lib modules create a Supabase client at import time. Give them dummy
// values; unit tests never talk to a real network service.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unit-test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-service-role-key'
process.env.TRACKING_SECRET ||= 'unit-test-tracking-secret'
delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.REACHER_URL
delete process.env.EMAIL_VERIFIER_API_KEY
delete process.env.ENABLE_SMTP_VERIFY
delete process.env.HUNTER_API_KEY
