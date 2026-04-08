import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ── Claude API Pricing (per 1M tokens) — update here when rates change ─────────
export const CLAUDE_PRICING: Record<string, {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}> = {
  'claude-opus-4-6':             { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-6':           { input:  3.00, output: 15.00, cacheWrite:  3.75, cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':   { input:  0.80, output:  4.00, cacheWrite:  1.00, cacheRead: 0.08 },
};

/** Compute cost for a single token-log entry from first principles. */
export function computeEntryCost(entry: {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  cache_write_tokens?: number;
}): number {
  const pricing = CLAUDE_PRICING[entry.model];
  if (!pricing) return 0;
  const input      = (entry.input_tokens       ?? 0) / 1_000_000 * pricing.input;
  const output     = (entry.output_tokens      ?? 0) / 1_000_000 * pricing.output;
  const cacheRead  = (entry.cached_tokens      ?? 0) / 1_000_000 * pricing.cacheRead;
  const cacheWrite = (entry.cache_write_tokens ?? 0) / 1_000_000 * pricing.cacheWrite;
  return input + output + cacheRead + cacheWrite;
}

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const TOKEN_LOG = process.env.TOKEN_LOG_PATH || path.join(HOME, '.claude', 'agents', 'token-log.jsonl');

// Helper: parse a JSONL file, returning an array of parsed objects
function parseJsonl(filePath: string): any[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Helper: read JSON file
function readJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// 1. getSessions — parse history.jsonl + session-data/ temp files
export async function getSessions(): Promise<any[]> {
  const history = parseJsonl(path.join(CLAUDE_DIR, 'history.jsonl'));

  // Group history entries by sessionId
  const sessionMap: Record<string, any[]> = {};
  for (const entry of history) {
    const sid = entry.sessionId || 'unknown';
    if (!sessionMap[sid]) sessionMap[sid] = [];
    sessionMap[sid].push(entry);
  }

  const sessions = Object.entries(sessionMap).map(([sessionId, entries]) => {
    const timestamps = entries.map((e) => e.timestamp).filter(Boolean).sort();
    const start = timestamps[0];
    const end = timestamps[timestamps.length - 1];
    const durationMs = start && end ? end - start : 0;
    const project = entries[0]?.project || null;
    return {
      sessionId,
      project,
      start: start ? new Date(start).toISOString() : null,
      end: end ? new Date(end).toISOString() : null,
      durationMs,
      messageCount: entries.length,
      entries,
    };
  });

  // Also read session-data temp files for extra context
  const sessionDataDir = path.join(CLAUDE_DIR, 'session-data');
  let tempFiles: string[] = [];
  try {
    tempFiles = fs.readdirSync(sessionDataDir).filter((f) => f.endsWith('.tmp'));
  } catch { /* dir might not exist */ }

  const tempSessions = tempFiles.map((f) => {
    const filePath = path.join(sessionDataDir, f);
    let content = '';
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { /* ignore */ }
    const stat = fs.statSync(filePath);
    return {
      sessionId: f.replace('.tmp', ''),
      file: f,
      content,
      mtime: stat.mtime.toISOString(),
    };
  });

  return [...sessions, ...tempSessions.map((t) => ({ ...t, source: 'session-data' }))];
}

// 2. getCosts — parse costs.jsonl
export async function getCosts(): Promise<any[]> {
  return parseJsonl(path.join(CLAUDE_DIR, 'metrics', 'costs.jsonl'));
}

// 3. getActivity — daily/hourly counts + streaks derived from history.jsonl
export async function getActivity(): Promise<{
  daily: Record<string, { messages: number; sessions: number; tokens: number }>;
  hourly: Record<string, number>;
  streak: { current: number; longest: number };
}> {
  const history = parseJsonl(path.join(CLAUDE_DIR, 'history.jsonl'));
  const costs = parseJsonl(path.join(CLAUDE_DIR, 'metrics', 'costs.jsonl'));

  const daily: Record<string, { messages: number; sessions: Set<string>; tokens: number }> = {};
  const hourly: Record<string, number> = {};

  // Build token lookup by date from costs
  const tokensByDate: Record<string, number> = {};
  for (const c of costs) {
    if (!c.timestamp) continue;
    const date = c.timestamp.slice(0, 10);
    tokensByDate[date] = (tokensByDate[date] || 0) + (c.input_tokens || 0) + (c.output_tokens || 0);
  }

  for (const entry of history) {
    if (!entry.timestamp) continue;
    const d = new Date(entry.timestamp);
    const dateStr = d.toISOString().slice(0, 10);
    const hourStr = String(d.getUTCHours());

    if (!daily[dateStr]) daily[dateStr] = { messages: 0, sessions: new Set(), tokens: 0 };
    daily[dateStr].messages += 1;
    if (entry.sessionId) daily[dateStr].sessions.add(entry.sessionId);

    hourly[hourStr] = (hourly[hourStr] || 0) + 1;
  }

  // Merge tokens
  const dailyFinal: Record<string, { messages: number; sessions: number; tokens: number }> = {};
  for (const [date, val] of Object.entries(daily)) {
    dailyFinal[date] = {
      messages: val.messages,
      sessions: val.sessions.size,
      tokens: tokensByDate[date] || 0,
    };
  }

  // Streaks
  const sortedDates = Object.keys(dailyFinal).sort();
  let current = 0;
  let longest = 0;
  let streak = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < sortedDates.length; i++) {
    const d = sortedDates[i];
    const prev = i > 0 ? sortedDates[i - 1] : null;
    if (prev) {
      const diff = (new Date(d).getTime() - new Date(prev).getTime()) / 86400000;
      if (diff === 1) {
        streak += 1;
      } else {
        streak = 1;
      }
    } else {
      streak = 1;
    }
    longest = Math.max(longest, streak);
    if (d === today) current = streak;
  }
  // If last active date is today or yesterday, maintain current streak
  if (sortedDates.length > 0) {
    const lastDate = sortedDates[sortedDates.length - 1];
    const diff = (new Date(today).getTime() - new Date(lastDate).getTime()) / 86400000;
    if (diff > 1) current = 0;
  }

  return { daily: dailyFinal, hourly, streak: { current, longest } };
}

// 4. getHistory — raw history entries
export async function getHistory(): Promise<any[]> {
  return parseJsonl(path.join(CLAUDE_DIR, 'history.jsonl'));
}

// 5. getTokenLog — parse the agent token-log.jsonl
export async function getTokenLog(): Promise<any[]> {
  return parseJsonl(TOKEN_LOG);
}

// 6. getToolUsage — extract tool usage patterns from project JSONL session files
export interface ToolUsageEntry {
  tool: string;
  category: string;
  count: number;
  tokens: number; // estimated tokens attributed to this tool (split evenly across tools per turn)
  avgDuration: number | null;
  errorCount: number;
}

export async function getToolUsage(): Promise<ToolUsageEntry[]> {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  const toolCounts: Record<string, number> = {};
  const toolTokens: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};

  let projectDirs: string[] = [];
  try {
    projectDirs = fs.readdirSync(projectsDir);
  } catch {
    // no project data
  }

  for (const projDir of projectDirs) {
    const fullProjDir = path.join(projectsDir, projDir);
    let sessionFiles: string[] = [];
    try {
      const stat = fs.statSync(fullProjDir);
      if (!stat.isDirectory()) continue;
      sessionFiles = fs.readdirSync(fullProjDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const sessionFile of sessionFiles) {
      const filePath = path.join(fullProjDir, sessionFile);
      const entries = parseJsonl(filePath);

      for (const entry of entries) {
        const msg = entry.message ?? entry;
        if (!msg || msg.role !== 'assistant') continue;

        const content = msg.content;
        if (!Array.isArray(content)) continue;

        const toolUseItems = content.filter((c: any) => c?.type === 'tool_use');
        if (toolUseItems.length === 0) continue;

        // Attribute turn token usage evenly across all tools called in that turn
        const usage = msg.usage ?? {};
        const turnTokens =
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        const tokensPerTool = toolUseItems.length > 0 ? Math.round(turnTokens / toolUseItems.length) : 0;

        for (const item of toolUseItems) {
          const toolName: string = item.name ?? 'unknown';
          toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;
          toolTokens[toolName] = (toolTokens[toolName] ?? 0) + tokensPerTool;
        }
      }
    }
  }

  // Fallback: history.jsonl command patterns if no project session data found
  if (Object.keys(toolCounts).length === 0) {
    const history = parseJsonl(path.join(CLAUDE_DIR, 'history.jsonl'));
    for (const entry of history) {
      const display: string = entry.display || '';
      const toolMatch = display.match(/^(npx|node|bash|python|curl|git|brew|open)\s/i);
      if (toolMatch) {
        const tool = toolMatch[1].toLowerCase();
        toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
      }
    }
  }

  return Object.entries(toolCounts).map(([tool, count]) => ({
    tool,
    category: 'other',
    count,
    tokens: toolTokens[tool] ?? 0,
    avgDuration: null,
    errorCount: toolErrors[tool] ?? 0,
  }));
}

// 7. getProjects — read project directories from ~/.claude/projects/
export async function getProjects(): Promise<any[]> {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return [];
  }

  return dirs.map((dir) => {
    const dirPath = path.join(projectsDir, dir);
    let stat: fs.Stats | null = null;
    try { stat = fs.statSync(dirPath); } catch { /* ignore */ }

    // Convert encoded dir name back to path (- separator = /)
    const decodedPath = '/' + dir.replace(/-/g, '/').replace(/\/\//g, '-');

    let files: string[] = [];
    try {
      if (stat?.isDirectory()) {
        files = fs.readdirSync(dirPath);
      }
    } catch { /* ignore */ }

    return {
      id: dir,
      path: decodedPath,
      displayName: dir,
      files,
      mtime: stat?.mtime.toISOString() || null,
    };
  });
}

// 8. getPlans — read plan files from ~/.claude/plans/
export async function getPlans(): Promise<any[]> {
  const plansDir = path.join(CLAUDE_DIR, 'plans');
  let files: string[] = [];
  try {
    files = fs.readdirSync(plansDir);
  } catch {
    return [];
  }

  return files.map((f) => {
    const filePath = path.join(plansDir, f);
    let content = '';
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(filePath);
      if (stat.isFile()) {
        content = fs.readFileSync(filePath, 'utf8');
      }
    } catch { /* ignore */ }

    return {
      name: f,
      path: filePath,
      content,
      mtime: stat?.mtime.toISOString() || null,
      size: stat?.size || 0,
    };
  });
}

// 9. getSettings — read and merge settings.json + settings.local.json
export async function getSettings(): Promise<any> {
  const settings = readJson(path.join(CLAUDE_DIR, 'settings.json')) || {};
  const local = readJson(path.join(CLAUDE_DIR, 'settings.local.json')) || {};
  return { ...settings, ...local, _local: local };
}

// 10. getLiveUsage — fetch live 5h/7d rate limit percentages
// Primary: Supabase claude_usage_cache (fast, cached)
// Fallback: direct Claude API via OAuth token
export async function getLiveUsage(): Promise<{
  five_hour_pct: number | null;
  seven_day_pct: number | null;
  overage_pct?: number | null;
  updated_at?: string;
  source?: string;
} | null> {
  // Try Supabase cache first (env vars must be set)
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && key) {
      const out = execSync(
        `curl -s "${supabaseUrl}/rest/v1/claude_usage_cache?id=eq.1&select=five_hour_utilization,seven_day_utilization,seven_day_sonnet_utilization,updated_at" ` +
          `-H "apikey: ${key}" -H "Authorization: Bearer ${key}"`,
        { timeout: 5000 }
      ).toString();
      const rows = JSON.parse(out);
      if (Array.isArray(rows) && rows[0]) {
        const row = rows[0];
        return {
          five_hour_pct: row.five_hour_utilization ?? null,
          seven_day_pct: row.seven_day_utilization ?? null,
          overage_pct: row.seven_day_sonnet_utilization ?? null,
          updated_at: row.updated_at,
          source: 'supabase',
        };
      }
    }
  } catch { /* fall through to OAuth */ }

  // Fallback: OAuth token from macOS Keychain
  try {
    const credJson = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 5000 }
    ).toString().trim();
    const creds = JSON.parse(credJson);
    const token = creds?.claudeAiOauth?.accessToken;
    if (!token) return null;

    // Hit the Claude API usage endpoint
    const out = execSync(
      `curl -s "https://api.anthropic.com/v1/organizations/usage" ` +
        `-H "Authorization: Bearer ${token}" ` +
        `-H "anthropic-beta: oauth-2025-04-20" ` +
        `-H "anthropic-version: 2023-06-01"`,
      { timeout: 8000 }
    ).toString();
    const data = JSON.parse(out);
    // Return raw data if no structured pct fields available
    return {
      five_hour_pct: data.five_hour_pct ?? null,
      seven_day_pct: data.seven_day_pct ?? null,
      updated_at: new Date().toISOString(),
      source: 'oauth',
      raw: data,
    } as any;
  } catch { /* ignore */ }

  return null;
}
