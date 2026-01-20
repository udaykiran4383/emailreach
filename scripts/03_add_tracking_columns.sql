-- Run this in your Supabase SQL Editor to enable tracking features
-- This fixes the "column replied_at does not exist" error

ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS follow_up_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE email_recipients ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Verify columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'email_recipients';
