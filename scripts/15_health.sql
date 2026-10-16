-- Health checks: heartbeat of the background scheduler (Chronos / cron)
-- Run in the Supabase SQL Editor after scripts 08-14. Safe to re-run.

CREATE TABLE IF NOT EXISTS app_heartbeats (
  key TEXT PRIMARY KEY,                     -- e.g. 'cron'
  at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  detail JSONB                              -- summary of the last run
);

-- Only the service role (server) touches this table
ALTER TABLE app_heartbeats ENABLE ROW LEVEL SECURITY;
