-- Atomic helpers for concurrent writes + reply-sync watermark
-- Run in the Supabase SQL Editor after scripts 08-13. Safe to re-run.
-- Called by the server with the service-role key (supabase.rpc); not granted to anon/authenticated.

-- 1. Open tracking: one UPDATE instead of read-then-write, so simultaneous opens are all counted
CREATE OR REPLACE FUNCTION increment_open(p_recipient_id uuid, p_now timestamptz)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE email_recipients
  SET open_count = COALESCE(open_count, 0) + 1,
      opened_at = COALESCE(opened_at, p_now),
      last_opened_at = p_now
  WHERE id = p_recipient_id;
$$;

-- 2. Merge keys into email_recipients.variables without clobbering keys written by other features
CREATE OR REPLACE FUNCTION merge_recipient_variables(p_recipient_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE sql
AS $$
  UPDATE email_recipients
  SET variables = COALESCE(variables, '{}'::jsonb) || p_patch,
      updated_at = NOW()
  WHERE id = p_recipient_id
  RETURNING variables;
$$;

CREATE OR REPLACE FUNCTION merge_recipient_variables_bulk(p_ids uuid[], p_patch jsonb)
RETURNS integer
LANGUAGE sql
AS $$
  WITH updated AS (
    UPDATE email_recipients
    SET variables = COALESCE(variables, '{}'::jsonb) || p_patch,
        updated_at = NOW()
    WHERE id = ANY(p_ids)
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM updated;
$$;

REVOKE ALL ON FUNCTION increment_open(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_recipient_variables(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_recipient_variables_bulk(uuid[], jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION increment_open(uuid, timestamptz) TO service_role;
    GRANT EXECUTE ON FUNCTION merge_recipient_variables(uuid, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION merge_recipient_variables_bulk(uuid[], jsonb) TO service_role;
  END IF;
END $$;

-- 3. Reply sync watermark: each sync only lists mail newer than the previous run
ALTER TABLE sender_settings ADD COLUMN IF NOT EXISTS last_reply_sync_at TIMESTAMP WITH TIME ZONE;

-- 4. Index for sequence eligibility queries
CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign_status ON email_recipients(campaign_id, status);

-- Let PostgREST pick up the new functions immediately
NOTIFY pgrst, 'reload schema';
