-- Create a specific table for storing replies
CREATE TABLE IF NOT EXISTS email_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES email_recipients(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  gmail_message_id TEXT UNIQUE NOT NULL,
  gmail_thread_id TEXT,
  subject TEXT,
  from_email TEXT,
  body_snippet TEXT,
  full_body TEXT, -- Can be NULL if we only fetch snippet initially
  received_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_replies_recipient_id ON email_replies(recipient_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_campaign_id ON email_replies(campaign_id);

-- Enable RLS
ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;

-- Policies (inherit from campaign ownership)
CREATE POLICY "Users can view replies for their campaigns"
  ON email_replies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = email_replies.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert replies for their campaigns"
  ON email_replies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = email_replies.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );
