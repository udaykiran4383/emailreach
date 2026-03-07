-- Add sender_email column to campaigns table
-- This allows choosing between Gmail and IITB email when sending campaigns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS sender_email TEXT DEFAULT 'gmail';

-- Valid values: 'gmail' or 'iitb'
COMMENT ON COLUMN campaigns.sender_email IS 'Sender email preference: gmail or iitb';
