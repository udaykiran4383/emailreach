-- Saved jobs from public Greenhouse / Lever / Ashby boards ("hiring now" targeting)
-- Run in the Supabase SQL Editor after 08. Safe to re-run.

CREATE TABLE IF NOT EXISTS saved_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  domain TEXT NOT NULL,
  provider TEXT NOT NULL,          -- greenhouse | lever | ashby
  board_token TEXT NOT NULL,
  job_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  location TEXT,
  score INTEGER,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT saved_jobs_status CHECK (status IN ('saved', 'applied', 'dismissed')),
  CONSTRAINT saved_jobs_unique UNIQUE (user_id, provider, job_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_id ON saved_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_domain ON saved_jobs(domain);

-- Only the service role (server) touches this table
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
