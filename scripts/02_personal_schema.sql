-- Personal Use Schema (No Auth Dependencies)

-- 1. Clean up old tables if they exist
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS email_recipients CASCADE;
DROP TABLE IF EXISTS gmail_credentials CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;

-- 2. Create tables with TEXT user_id (instead of UUID references)
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- Changed from UUID REFERENCES auth.users
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  email_body_template TEXT NOT NULL,
  follow_up_template TEXT,
  follow_up_days INTEGER DEFAULT 5,
  resume_storage_path TEXT,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  total_recipients INTEGER DEFAULT 0,
  CONSTRAINT valid_status CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'archived'))
);

CREATE TABLE email_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  role TEXT,
  variables JSONB,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,
  follow_up_sent BOOLEAN DEFAULT FALSE,
  follow_up_sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'sent', 'replied', 'failed', 'skipped'))
);

CREATE TABLE gmail_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- Changed from UUID REFERENCES auth.users
  email_address TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES email_recipients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create indexes
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_email_recipients_campaign_id ON email_recipients(campaign_id);
CREATE INDEX idx_email_recipients_status ON email_recipients(status);
CREATE INDEX idx_gmail_credentials_user_id ON gmail_credentials(user_id);

-- 4. NO RLS (Row Level Security) needed for personal local use with hardcoded user
-- If RLS was previously enabled, we ensure it is disabled or policies allow all
ALTER TABLE campaigns DISABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipients DISABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_credentials DISABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs DISABLE ROW LEVEL SECURITY;
