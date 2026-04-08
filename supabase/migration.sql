-- Claude Usage Dashboard — Required Supabase Tables
-- Run this in your Supabase SQL editor to set up the database

-- Table: claude_usage_cache
-- Stores cached 5-hour and 7-day rate limit percentages
-- Updated by Claude Code hooks (stop-hook, session-start)
CREATE TABLE IF NOT EXISTS claude_usage_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  five_hour_pct REAL DEFAULT 0,
  seven_day_pct REAL DEFAULT 0,
  sonnet_pct REAL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the single cache row
INSERT INTO claude_usage_cache (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Table: agent_token_log
-- Stores per-task token usage from all Claude Code agents
-- Written to by hooks and agents at task completion
CREATE TABLE IF NOT EXISTS agent_token_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT now(),
  agent TEXT NOT NULL DEFAULT 'parent',
  task TEXT,
  category TEXT,
  model TEXT,
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cached_tokens BIGINT DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  five_hour_pct REAL,
  seven_day_pct REAL,
  tool_calls INTEGER DEFAULT 0,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for time-based queries (dashboard charts)
CREATE INDEX IF NOT EXISTS idx_agent_token_log_timestamp ON agent_token_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_token_log_agent ON agent_token_log (agent);
