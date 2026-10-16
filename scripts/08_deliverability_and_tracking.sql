-- Deliverability, open tracking, bounce handling and drip sending
-- Run in the Supabase SQL Editor after scripts 01-07. Safe to re-run.

-- 1. Campaign status: allow 'sending' and 'paused' (used by the send pipeline)
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE campaigns ADD CONSTRAINT valid_status
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'archived'));

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS track_opens BOOLEAN DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS auto_follow_up BOOLEAN DEFAULT FALSE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS paused_reason TEXT;

-- 2. Recipient status: allow 'bounced'
ALTER TABLE email_recipients DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE email_recipients ADD CONSTRAINT valid_status
  CHECK (status IN ('pending', 'sent', 'replied', 'failed', 'skipped', 'uncertain', 'bounced'));

-- Open tracking
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS open_count INTEGER DEFAULT 0;

-- Verification results (filled at upload/verify time and before sending)
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS verification_status TEXT; -- safe | risky | invalid
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS verification_reason TEXT;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

-- RFC 822 Message-ID of the first email, so follow-ups thread correctly in the recipient's inbox
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS rfc_message_id TEXT;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMP WITH TIME ZONE;

-- Reply columns (also created by 04, repeated so this script is self-sufficient)
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS reply_snippet TEXT;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS reply_from TEXT;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS reply_timestamp TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_email_recipients_sent_at ON email_recipients(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_recipients_follow_up_sent_at ON email_recipients(follow_up_sent_at);

-- 3. Per-user sending limits (protects the Gmail account from suspension)
CREATE TABLE IF NOT EXISTS sender_settings (
  user_id TEXT PRIMARY KEY,
  daily_limit INTEGER NOT NULL DEFAULT 50,          -- hard cap of emails per rolling 24h
  warmup_enabled BOOLEAN NOT NULL DEFAULT TRUE,     -- ramp up from warmup_start
  warmup_start INTEGER NOT NULL DEFAULT 15,
  warmup_increment INTEGER NOT NULL DEFAULT 5,      -- extra emails allowed per day of sending history
  min_delay_seconds INTEGER NOT NULL DEFAULT 60,    -- random gap between two emails
  max_delay_seconds INTEGER NOT NULL DEFAULT 150,
  send_window_start INTEGER NOT NULL DEFAULT 9,     -- local hour (0-23), inclusive
  send_window_end INTEGER NOT NULL DEFAULT 18,      -- local hour (0-23), exclusive
  skip_weekends BOOLEAN NOT NULL DEFAULT TRUE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  max_bounce_rate NUMERIC NOT NULL DEFAULT 3,       -- % ; campaign auto-pauses above this
  next_send_at TIMESTAMP WITH TIME ZONE,            -- send slot gate shared by all campaigns of the user
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only the service role (server) touches this table
ALTER TABLE sender_settings ENABLE ROW LEVEL SECURITY;

-- 4. Blocklist: allow 'unsubscribed' as a reason (column is free text already)
COMMENT ON COLUMN blocked_emails.reason IS 'bounced | invalid | unsubscribed | user_blocked';
