-- Create users table extension (for campaign ownership)
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  email_body_template TEXT NOT NULL,
  follow_up_template TEXT,
  follow_up_days INTEGER DEFAULT 5,
  resume_storage_path TEXT,
  status TEXT DEFAULT 'draft', -- draft, scheduled, sent, archived
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  total_recipients INTEGER DEFAULT 0,
  CONSTRAINT valid_status CHECK (status IN ('draft', 'scheduled', 'sent', 'archived'))
);

CREATE TABLE IF NOT EXISTS email_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  role TEXT,
  variables JSONB, -- Store additional template variables
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  status TEXT DEFAULT 'pending', -- pending, sent, replied, failed
  sent_at TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,
  follow_up_sent BOOLEAN DEFAULT FALSE,
  follow_up_sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT valid_status CHECK (status IN ('pending', 'sent', 'replied', 'failed', 'skipped'))
);

CREATE TABLE IF NOT EXISTS gmail_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE,
  email_address TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES email_recipients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- sent, opened, replied, failed, follow_up_sent
  event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign_id ON email_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_recipients_status ON email_recipients(status);
CREATE INDEX IF NOT EXISTS idx_email_recipients_email ON email_recipients(email);
CREATE INDEX IF NOT EXISTS idx_gmail_credentials_user_id ON gmail_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient_id ON email_logs(recipient_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type ON email_logs(event_type);

-- Enable Row Level Security
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for campaigns
CREATE POLICY "Users can view their own campaigns"
  ON campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON campaigns FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON campaigns FOR DELETE
  USING (auth.uid() = user_id);

-- Create RLS policies for email_recipients (through campaign ownership)
CREATE POLICY "Users can view recipients in their campaigns"
  ON email_recipients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = email_recipients.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert recipients in their campaigns"
  ON email_recipients FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = email_recipients.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update recipients in their campaigns"
  ON email_recipients FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = email_recipients.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete recipients in their campaigns"
  ON email_recipients FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM campaigns 
      WHERE campaigns.id = email_recipients.campaign_id 
      AND campaigns.user_id = auth.uid()
    )
  );

-- Create RLS policies for gmail_credentials
CREATE POLICY "Users can view their own gmail credentials"
  ON gmail_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own gmail credentials"
  ON gmail_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own gmail credentials"
  ON gmail_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own gmail credentials"
  ON gmail_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- Create RLS policies for email_logs (through recipient campaign)
CREATE POLICY "Users can view logs for their recipients"
  ON email_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM email_recipients
      JOIN campaigns ON campaigns.id = email_recipients.campaign_id
      WHERE email_recipients.id = email_logs.recipient_id
      AND campaigns.user_id = auth.uid()
    )
  );
