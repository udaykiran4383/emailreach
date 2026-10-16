-- AI reply classification + personalization
-- Run in the Supabase SQL Editor after scripts 01-08. Safe to re-run.

-- Reply classification (interview_request, referral, send_resume, interested,
-- not_hiring, rejection, out_of_office, unsubscribe, auto_reply_other, other)
ALTER TABLE email_replies ADD COLUMN IF NOT EXISTS classification TEXT;
ALTER TABLE email_replies ADD COLUMN IF NOT EXISTS classification_reason TEXT;
ALTER TABLE email_replies ADD COLUMN IF NOT EXISTS classified_by TEXT;          -- 'ai' | 'rules'
ALTER TABLE email_replies ADD COLUMN IF NOT EXISTS classified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_replies ADD COLUMN IF NOT EXISTS return_date DATE;             -- out-of-office "back on" date

CREATE INDEX IF NOT EXISTS idx_email_replies_classification ON email_replies(classification);
CREATE INDEX IF NOT EXISTS idx_email_replies_received_at ON email_replies(received_at);

-- Personalized openers live in email_recipients.variables (JSONB):
--   opener_draft      generated/edited text, never sent on its own
--   opener            the approved text the sender substitutes for {{opener}} ('' until approved)
--   opener_basis, opener_confidence (high|medium|low|manual|failed), opener_approved
-- Make sure the column exists and is never NULL so merges are simple.
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS variables JSONB;
UPDATE email_recipients SET variables = '{}'::jsonb WHERE variables IS NULL;
ALTER TABLE email_recipients ALTER COLUMN variables SET DEFAULT '{}'::jsonb;
