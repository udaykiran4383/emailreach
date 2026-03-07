-- Add 'uncertain' to the valid status check constraint for email_recipients
DO $$
BEGIN
    ALTER TABLE email_recipients DROP CONSTRAINT IF EXISTS valid_status;
    ALTER TABLE email_recipients 
    ADD CONSTRAINT valid_status 
    CHECK (status IN ('pending', 'sent', 'replied', 'failed', 'skipped', 'uncertain'));
END $$;
