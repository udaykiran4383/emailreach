-- Create blocked_emails table to prevent sending to invalid/bounced addresses
CREATE TABLE IF NOT EXISTS blocked_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  reason TEXT NOT NULL, -- 'bounced', 'invalid', 'user_blocked'
  blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_blocked_emails_email ON blocked_emails(email);

-- Disable RLS for personal use (consistent with other tables)
ALTER TABLE blocked_emails DISABLE ROW LEVEL SECURITY;
