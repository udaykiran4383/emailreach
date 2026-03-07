-- Add reply content columns to email_recipients
ALTER TABLE email_recipients 
ADD COLUMN IF NOT EXISTS reply_snippet TEXT,
ADD COLUMN IF NOT EXISTS reply_from TEXT,
ADD COLUMN IF NOT EXISTS reply_timestamp TIMESTAMPTZ;
