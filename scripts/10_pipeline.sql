-- Application pipeline (kanban): one row per company / job you're pursuing
-- Run in the Supabase SQL Editor after 08. Safe to re-run.

CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  company TEXT NOT NULL,
  domain TEXT NOT NULL,
  job_title TEXT,
  job_url TEXT,
  stage TEXT NOT NULL DEFAULT 'target',
  source TEXT,                         -- manual | campaign | jobs | find-contacts ...
  notes TEXT,
  next_step TEXT,
  next_step_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  stage_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT applications_valid_stage
    CHECK (stage IN ('target', 'contacted', 'replied', 'interview', 'offer', 'rejected'))
);

-- One application per company + job posting (general company entry has no job_url)
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique
  ON applications (user_id, domain, COALESCE(job_url, ''));
CREATE INDEX IF NOT EXISTS idx_applications_user_stage ON applications (user_id, stage);
CREATE INDEX IF NOT EXISTS idx_applications_user_domain ON applications (user_id, domain);

CREATE TABLE IF NOT EXISTS application_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT application_activity_valid_kind
    CHECK (kind IN ('stage_change', 'note', 'email_sent', 'reply', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_application_activity_app ON application_activity (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_application_activity_user ON application_activity (user_id, created_at DESC);

-- Server only (service role); no policies means the anon/user key can't read these
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_activity ENABLE ROW LEVEL SECURITY;
