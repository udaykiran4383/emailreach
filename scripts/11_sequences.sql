-- Multi-step sequences, recipient-timezone sending and inbox placement tests
-- Run in the Supabase SQL Editor after 08. Safe to re-run.

-- 1. Sequence steps. Step 1 is the campaign's main template; steps 2..N live here.
CREATE TABLE IF NOT EXISTS campaign_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number >= 2),
  delay_days INTEGER NOT NULL CHECK (delay_days BETWEEN 1 AND 60),
  subject TEXT,            -- NULL = reply in the same thread ("Re: <original subject>")
  body TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (campaign_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign_id ON campaign_steps(campaign_id);

-- Same visibility as campaigns (the app also uses the service role for cron)
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage steps of their campaigns" ON campaign_steps;
CREATE POLICY "Users manage steps of their campaigns"
  ON campaign_steps FOR ALL
  USING (EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_steps.campaign_id AND campaigns.user_id::text = auth.uid()::text))
  WITH CHECK (EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_steps.campaign_id AND campaigns.user_id::text = auth.uid()::text));

-- 2. Per-recipient sequence progress
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS last_step_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS next_step_not_before TIMESTAMP WITH TIME ZONE; -- e.g. after an out-of-office reply
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS sequence_stopped BOOLEAN DEFAULT FALSE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS sequence_stop_reason TEXT;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS timezone TEXT; -- recipient's guessed IANA timezone

CREATE INDEX IF NOT EXISTS idx_email_recipients_last_step_sent_at ON email_recipients(last_step_sent_at);

-- 3. Backfill: the old single follow-up becomes step 2
INSERT INTO campaign_steps (campaign_id, step_number, delay_days, subject, body)
SELECT id, 2, LEAST(GREATEST(COALESCE(follow_up_days, 5), 1), 60), NULL, follow_up_template
FROM campaigns
WHERE follow_up_template IS NOT NULL AND btrim(follow_up_template) <> ''
ON CONFLICT (campaign_id, step_number) DO NOTHING;

UPDATE email_recipients
SET current_step = 2, last_step_sent_at = follow_up_sent_at
WHERE follow_up_sent = TRUE AND (current_step IS NULL OR current_step < 2);

-- 4. Send in the recipient's local business hours (opt-in)
ALTER TABLE sender_settings ADD COLUMN IF NOT EXISTS use_recipient_timezone BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Inbox placement tests (seed sends count against the daily budget)
CREATE TABLE IF NOT EXISTS placement_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  seeds JSONB NOT NULL DEFAULT '[]', -- [{ email, sent, error, placement: 'inbox'|'promotions'|'spam'|'missing'|null }]
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_placement_tests_user_id ON placement_tests(user_id, created_at);

-- Only the server (service role) touches this table
ALTER TABLE placement_tests ENABLE ROW LEVEL SECURITY;
