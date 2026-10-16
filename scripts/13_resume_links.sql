-- Tracked resume links + API tokens (for the MCP server)
-- Run in the Supabase SQL Editor after 08. Safe to re-run.

-- 1. Resume links: send a link instead of attaching the PDF to cold emails
CREATE TABLE IF NOT EXISTS resume_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_links_campaign ON resume_links(campaign_id);

CREATE TABLE IF NOT EXISTS resume_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES resume_links(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES email_recipients(id) ON DELETE SET NULL,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ua TEXT,
  is_proxy BOOLEAN DEFAULT FALSE  -- link scanners / previews, excluded from stats
);
CREATE INDEX IF NOT EXISTS idx_resume_views_link ON resume_views(link_id);
CREATE INDEX IF NOT EXISTS idx_resume_views_recipient ON resume_views(recipient_id);

-- When false, the sender skips the PDF attachment (the email carries {{resume_url}} instead)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attach_resume BOOLEAN DEFAULT TRUE;

-- Only the service role touches these tables
ALTER TABLE resume_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_views ENABLE ROW LEVEL SECURITY;

-- 2. Personal API tokens (Authorization: Bearer erk_...) used by the MCP server
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,   -- sha256 of the token; the token itself is shown once
  token_prefix TEXT NOT NULL,        -- first characters, to recognise it in the UI
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
