import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import os from 'os';
import { getAppConfig } from './app-config';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId: string;
}

export interface CostEntry {
  timestamp: string;
  session_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface StatsCache {
  dailyActivity: Record<string, { messages: number; sessions: number; tools: number }>;
  modelUsage: Record<string, Record<string, number>>;
  hourDistribution: Record<string, number>;
  lastComputed: string;
}

export interface SessionSummary {
  id: string;
  date: string;
  project: string;
  branch?: string;
  filesModified: string[];
  summary: string;
  filePath: string;
}

export interface PlanEntry {
  name: string;
  content: string;
  frontmatter: Record<string, any>;
  filePath: string;
}

export interface ProjectInfo {
  slug: string;
  displayName: string;
  path: string;
  sessionCount: number;
  lastActive: string;
  totalTokens: number;
  totalCost: number;
  totalMessages: number;
  modelUsage: Record<string, number>;
  toolUsage: Record<string, number>;
  branches: string[];
}

export interface TokenLogEntry {
  timestamp: string;
  agent: string;
  task: string;
  category: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  five_hour_pct: number;
  seven_day_pct: number;
  tool_calls: number;
}

export interface LiveUsage {
  ts: string;
  fiveHour: number;
  sevenDay: number;
  sevenDaySonnet: number;
  fiveHourResetsAt: string;
  sevenDayResetsAt: string;
  source: string;
}

export interface ActivityData {
  daily: Record<string, { messages: number; sessions: number; tokens: number }>;
  hourly: Record<string, number>;
  streak: { current: number; longest: number };
}

export interface ToolUsageEntry {
  tool: string;
  category: string;
  count: number;
  tokens: number; // estimated tokens attributed to this tool (turn tokens divided evenly across tools per turn)
  avgDuration?: number;
  errorCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripMarkdown(s: string): string {
  return s.replace(/\*+/g, '').trim();
}

// Per-token cost in USD per million tokens [input, output, cacheWrite, cacheRead]
// ASSUMPTIONS: Cache reads use blended $1/MTok (mix of Opus $1.50 + Sonnet $0.30).
// Output uses model-specific rates. Actual costs vary by session model mix.
// Claude Max subscription = flat monthly fee; these are API-equivalent estimates.
export const CLAUDE_PRICING: Record<string, [number, number, number, number]> = {
  'claude-opus-4-6':           [15.00, 75.00, 18.75, 1.00],
  'claude-sonnet-4-6':         [ 3.00, 15.00,  3.75, 1.00],
  'claude-haiku-4-5-20251001': [ 0.80,  4.00,  1.00, 1.00],
  'claude-haiku-4-5':          [ 0.80,  4.00,  1.00, 1.00],
  // legacy keyword fallbacks
  opus:   [15.00, 75.00, 18.75, 1.00],
  sonnet: [ 3.00, 15.00,  3.75, 1.00],
  haiku:  [ 0.80,  4.00,  1.00, 1.00],
};

function modelPricing(model: string): [number, number, number, number] {
  if (CLAUDE_PRICING[model]) return CLAUDE_PRICING[model];
  const m = model.toLowerCase();
  if (m.includes('opus'))  return CLAUDE_PRICING['opus'];
  if (m.includes('haiku')) return CLAUDE_PRICING['haiku'];
  return CLAUDE_PRICING['sonnet']; // sonnet default
}

function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheWriteTokens: number = 0, cacheReadTokens: number = 0): number {
  const [inputRate, outputRate, cacheWriteRate, cacheReadRate] = modelPricing(model);
  return (inputTokens * inputRate + outputTokens * outputRate + cacheWriteTokens * cacheWriteRate + cacheReadTokens * cacheReadRate) / 1_000_000;
}

export function computeEntryCost(entry: { model: string; input_tokens: number; output_tokens: number; cached_tokens?: number; cache_write_tokens?: number }): number {
  return estimateCost(entry.model, entry.input_tokens ?? 0, entry.output_tokens ?? 0, entry.cache_write_tokens ?? 0, entry.cached_tokens ?? 0);
}

function computeIncrementalCost(
  model: string,
  inputDelta: number,
  outputDelta: number,
  cacheDelta: number,
): number {
  const [inputRate, outputRate, , cacheReadRate] = modelPricing(model);
  return (
    (inputDelta  * inputRate +
     outputDelta * outputRate +
     cacheDelta  * cacheReadRate) /
    1_000_000
  );
}

/** Stream-parse a JSONL file line-by-line without loading it entirely into memory */
async function parseJSONLStream(
  filePath: string,
  onLine: (parsed: any) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stream: ReturnType<typeof createReadStream>;
    try {
      stream = createReadStream(filePath, { encoding: 'utf8' });
    } catch {
      resolve();
      return;
    }
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        onLine(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    });
    rl.on('close', resolve);
    rl.on('error', () => resolve()); // gracefully skip unreadable files
    stream.on('error', () => { rl.close(); resolve(); });
  });
}

export async function readJSONL<T = any>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const results: T[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function listFiles(dir: string, ext?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name));
    if (ext) return files.filter((f) => f.endsWith(ext));
    return files;
  } catch {
    return [];
  }
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, any>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      try {
        frontmatter[key] = JSON.parse(val);
      } catch {
        frontmatter[key] = val;
      }
    } else {
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body: match[2] };
}

async function readJsonObject(filePath: string): Promise<Record<string, any>> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, any>;
  } catch {
    return {};
  }
}

interface ProjectSessionFileIndexEntry {
  slug: string;
  projectPath: string;
  filePath: string;
  mtimeMs: number;
  size: number;
}

interface ClaudeProjectIndex {
  projectDirs: Array<{ slug: string; projectPath: string }>;
  sessionFiles: ProjectSessionFileIndexEntry[];
  signature: string;
}

const readerCache = new Map<string, { signature: string; value: unknown }>();
const projectSummaryCache = new Map<string, { signature: string; value: ProjectInfo }>();

async function buildClaudeProjectIndex(): Promise<ClaudeProjectIndex> {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  const projectDirs: Array<{ slug: string; projectPath: string }> = [];
  const sessionFiles: ProjectSessionFileIndexEntry[] = [];

  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const projectPath = path.join(projectsDir, slug);
      projectDirs.push({ slug, projectPath });

      const files = await listFiles(projectPath, '.jsonl');
      for (const filePath of files) {
        try {
          const stat = await fs.stat(filePath);
          sessionFiles.push({
            slug,
            projectPath,
            filePath,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        } catch {
          // ignore transient files
        }
      }
    }
  } catch {
    // ignore missing Claude projects dir
  }

  const signature = [
    projectDirs.map((project) => `dir:${project.slug}`).sort().join('|'),
    sessionFiles
      .map((entry) => `${entry.slug}:${path.basename(entry.filePath)}:${entry.mtimeMs}:${entry.size}`)
      .sort()
      .join('|'),
  ].join('::');

  return { projectDirs, sessionFiles, signature };
}

async function withIndexedCache<T>(
  key: string,
  compute: (index: ClaudeProjectIndex) => Promise<T>,
): Promise<T> {
  const index = await buildClaudeProjectIndex();
  const cached = readerCache.get(key);
  if (cached?.signature === index.signature) {
    return cached.value as T;
  }

  const value = await compute(index);
  readerCache.set(key, { signature: index.signature, value });
  return value;
}

// ── Data Fetchers ─────────────────────────────────────────────────────────────

export async function getHistory(): Promise<HistoryEntry[]> {
  return readJSONL<HistoryEntry>(path.join(CLAUDE_DIR, 'history.jsonl'));
}

export async function getCosts(): Promise<CostEntry[]> {
  return readJSONL<CostEntry>(path.join(CLAUDE_DIR, 'metrics', 'costs.jsonl'));
}

export async function getStatsCache(): Promise<StatsCache> {
  try {
    const content = await fs.readFile(path.join(CLAUDE_DIR, 'stats-cache.json'), 'utf-8');
    const raw = JSON.parse(content);
    return {
      dailyActivity: raw.dailyActivity ?? raw.daily_activity ?? {},
      modelUsage: raw.modelUsage ?? raw.model_usage ?? {},
      hourDistribution: raw.hourDistribution ?? raw.hour_distribution ?? {},
      lastComputed: raw.lastComputed ?? raw.last_computed ?? new Date().toISOString(),
    };
  } catch {
    return {
      dailyActivity: {},
      modelUsage: {},
      hourDistribution: {},
      lastComputed: new Date().toISOString(),
    };
  }
}

export async function getSessions(): Promise<SessionSummary[]> {
  const sessionDir = path.join(CLAUDE_DIR, 'session-data');
  const files = await listFiles(sessionDir, '.tmp');
  const sessions: SessionSummary[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);

      const dateMatch = body.match(/[Dd]ate[:\s]+([^\n]+)/);
      const projectMatch = body.match(/[Pp]roject[:\s]+([^\n]+)/);
      const branchMatch = body.match(/[Bb]ranch[:\s]+([^\n]+)/);

      // Extract file list from bullets under "Files Modified"
      const filesModified: string[] = [];
      const filesBulletMatch = body.match(
        /[Ff]iles?\s+[Mm]odified[\s\S]*?\n((?:\s*[-*]\s+[^\n]+\n?)+)/
      );
      if (filesBulletMatch) {
        for (const line of filesBulletMatch[1].split('\n')) {
          const m = line.match(/^\s*[-*]\s+(.+)/);
          if (m) filesModified.push(m[1].trim());
        }
      }

      const name = path.basename(filePath, '.tmp');
      const rawDate = frontmatter.date ?? dateMatch?.[1]?.trim() ?? '';
      sessions.push({
        id: frontmatter.id ?? name,
        date: stripMarkdown(rawDate),
        project: stripMarkdown(frontmatter.project ?? projectMatch?.[1]?.trim() ?? ''),
        branch: frontmatter.branch ? stripMarkdown(frontmatter.branch) : branchMatch?.[1] ? stripMarkdown(branchMatch[1]) : undefined,
        filesModified,
        summary: body.slice(0, 500).trim(),
        filePath,
      });
    } catch {
      // skip unreadable files
    }
  }

  return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPlans(): Promise<PlanEntry[]> {
  const plansDir = path.join(CLAUDE_DIR, 'plans');
  const files = await listFiles(plansDir, '.md');
  const plans: PlanEntry[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);
      plans.push({
        name: path.basename(filePath, '.md'),
        content: body,
        frontmatter,
        filePath,
      });
    } catch {
      // skip
    }
  }

  return plans;
}

export async function getSettings(): Promise<any> {
  const [base, local] = await Promise.all([
    readJsonObject(path.join(CLAUDE_DIR, 'settings.json')),
    readJsonObject(path.join(CLAUDE_DIR, 'settings.local.json')),
  ]);

  return {
    ...base,
    ...local,
    env: { ...(base.env ?? {}), ...(local.env ?? {}) },
    hooks: { ...(base.hooks ?? {}), ...(local.hooks ?? {}) },
    plugins: local.plugins ?? base.plugins,
  };
}

/**
 * Decode a Claude project slug back to a display path.
 * Slugs start with '-' (representing leading '/'), then path components
 * separated by '-'. We preserve multi-word components that used spaces.
 * Since the slug uses '-' for BOTH '/' and '-' in original names, we do a
 * best-effort decode: replace leading '-' with '/', then split on '-'.
 */
function slugToDisplayPath(slug: string): string {
  // The slug is just the filesystem path with '/' replaced by '-' and a leading '-'
  // e.g. -Users-username-... -> /Users/username/...
  // For slugs that used '~' in the path, those show up as literal '~'
  return ('/' + slug).replace(/-/g, '/');
}

function slugToDisplayName(slug: string): string {
  // The slug uses '-' as separator for BOTH '/' and '-' in original paths.
  // Best we can do: strip leading '-', take the last 1-2 non-trivial segments.
  // Common path prefixes we want to skip
  const SKIP_SEGMENTS = new Set([
    'Users', os.userInfo().username, 'home', 'Library', 'Mobile', 'Documents',
    'com', 'apple', 'CloudDocs', 'Projects', 'projects',
    'claude', 'skills', 'claude-skills',
  ]);
  const parts = slug.replace(/^-/, '').split('-').filter(Boolean);
  const meaningful = parts.filter((p) => !SKIP_SEGMENTS.has(p) && p.length > 1);
  if (meaningful.length === 0) return parts[parts.length - 1] || slug;
  // Return last 2 meaningful parts joined with /
  const last2 = meaningful.slice(-2);
  return last2.join('/');
}

/** Parse a single JSONL session file, accumulating stats into accumulators */
async function parseSessionFile(
  filePath: string,
  acc: {
    totalTokens: number;
    totalCost: number;
    totalMessages: number;
    modelUsage: Record<string, number>;
    toolUsage: Record<string, number>;
    branches: Set<string>;
    lastActive: number;
    sessionSummaries: Array<{ sessionId: string; firstTimestamp: string; lastTimestamp: string; messageCount: number }>;
  }
): Promise<void> {
  let sessionId = '';
  let firstTs = 0;
  let lastTs = 0;
  let msgCount = 0;

  await parseJSONLStream(filePath, (entry: any) => {
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
    if (ts && ts > acc.lastActive) acc.lastActive = ts;
    if (ts && (!firstTs || ts < firstTs)) firstTs = ts;
    if (ts && ts > lastTs) lastTs = ts;

    if (!sessionId && entry.sessionId) sessionId = entry.sessionId;

    // Count user messages
    if (entry.type === 'user') {
      msgCount += 1;

      // gitBranch from user turns
      if (entry.gitBranch && entry.gitBranch !== 'HEAD') {
        acc.branches.add(entry.gitBranch);
      }
    }

    // Extract model, tokens, tool_use from assistant entries
    if (entry.type === 'assistant') {
      const msg = entry.message;
      if (!msg) return;

      const model: string = msg.model ?? '';
      const usage = msg.usage ?? {};
      const inputTokens: number = usage.input_tokens ?? 0;
      const cacheWriteTokens: number = usage.cache_creation_input_tokens ?? 0;
      const cacheReadTokens: number = usage.cache_read_input_tokens ?? 0;
      const outputTokens: number = usage.output_tokens ?? 0;
      const totalTurn = inputTokens + cacheWriteTokens + cacheReadTokens + outputTokens;

      if (totalTurn > 0 && model) {
        acc.totalTokens += totalTurn;
        acc.totalCost += estimateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);
        acc.modelUsage[model] = (acc.modelUsage[model] ?? 0) + totalTurn;
      }

      // Tool usage from message.content array
      const content: any[] = msg.content ?? [];
      for (const block of content) {
        if (block.type === 'tool_use') {
          const toolName: string = block.name ?? 'unknown';
          acc.toolUsage[toolName] = (acc.toolUsage[toolName] ?? 0) + 1;
        }
      }
    }
  });

  if (sessionId || firstTs) {
    acc.sessionSummaries.push({
      sessionId: sessionId || path.basename(filePath, '.jsonl'),
      firstTimestamp: firstTs ? new Date(firstTs).toISOString() : '',
      lastTimestamp: lastTs ? new Date(lastTs).toISOString() : '',
      messageCount: msgCount,
    });
    acc.totalMessages += msgCount;
  }
}

export async function getProjects(): Promise<ProjectInfo[]> {
  const index = await buildClaudeProjectIndex();
  const filesBySlug = new Map<string, ProjectSessionFileIndexEntry[]>();
  const projects: ProjectInfo[] = [];

  for (const sessionFile of index.sessionFiles) {
    const bucket = filesBySlug.get(sessionFile.slug) ?? [];
    bucket.push(sessionFile);
    filesBySlug.set(sessionFile.slug, bucket);
  }

  for (const { slug } of index.projectDirs) {
    const sessionFiles = filesBySlug.get(slug) ?? [];
    const signature = sessionFiles
      .map((entry) => `${path.basename(entry.filePath)}:${entry.mtimeMs}:${entry.size}`)
      .sort()
      .join('|');
    const cached = projectSummaryCache.get(slug);

    if (cached?.signature === signature) {
      projects.push(cached.value);
      continue;
    }

    let projectInfo: ProjectInfo;
    if (sessionFiles.length === 0) {
      projectInfo = {
        slug,
        displayName: slugToDisplayName(slug),
        path: slugToDisplayPath(slug),
        sessionCount: 0,
        lastActive: '',
        totalTokens: 0,
        totalCost: 0,
        totalMessages: 0,
        modelUsage: {},
        toolUsage: {},
        branches: [],
      };
    } else {
      const acc = {
        totalTokens: 0,
        totalCost: 0,
        totalMessages: 0,
        modelUsage: {} as Record<string, number>,
        toolUsage: {} as Record<string, number>,
        branches: new Set<string>(),
        lastActive: 0,
        sessionSummaries: [] as Array<{ sessionId: string; firstTimestamp: string; lastTimestamp: string; messageCount: number }>,
      };

      await Promise.all(sessionFiles.map((entry) => parseSessionFile(entry.filePath, acc)));

      if (!acc.lastActive) {
        acc.lastActive = sessionFiles.reduce(
          (max, entry) => (entry.mtimeMs > max ? entry.mtimeMs : max),
          0,
        );
      }

      projectInfo = {
        slug,
        displayName: slugToDisplayName(slug),
        path: slugToDisplayPath(slug),
        sessionCount: sessionFiles.length,
        lastActive: acc.lastActive ? new Date(acc.lastActive).toISOString() : '',
        totalTokens: acc.totalTokens,
        totalCost: acc.totalCost,
        totalMessages: acc.totalMessages,
        modelUsage: acc.modelUsage,
        toolUsage: acc.toolUsage,
        branches: Array.from(acc.branches),
      };
    }

    projectSummaryCache.set(slug, { signature, value: projectInfo });
    projects.push(projectInfo);
  }

  return projects.sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}

export interface ProjectSessionInfo {
  sessionId: string;
  firstTimestamp: string;
  lastTimestamp: string;
  messageCount: number;
  totalTokens: number;
  totalCost: number;
  model: string;
  toolUsage: Record<string, number>;
  gitBranch: string;
}

export async function getProjectSessions(projectSlug: string): Promise<ProjectSessionInfo[]> {
  const projectPath = path.join(CLAUDE_DIR, 'projects', projectSlug);
  const files = await listFiles(projectPath, '.jsonl');
  const sessions: ProjectSessionInfo[] = [];

  for (const filePath of files) {
    let sessionId = path.basename(filePath, '.jsonl');
    let firstTs = 0;
    let lastTs = 0;
    let messageCount = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let lastModel = '';
    const toolUsage: Record<string, number> = {};
    let gitBranch = '';

    await parseJSONLStream(filePath, (entry: any) => {
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      if (ts && (!firstTs || ts < firstTs)) firstTs = ts;
      if (ts && ts > lastTs) lastTs = ts;

      if (!sessionId && entry.sessionId) sessionId = entry.sessionId;

      if (entry.type === 'user') {
        messageCount += 1;
        if (entry.gitBranch && entry.gitBranch !== 'HEAD' && !gitBranch) {
          gitBranch = entry.gitBranch;
        }
      }

      if (entry.type === 'assistant') {
        const msg = entry.message;
        if (!msg) return;
        const model: string = msg.model ?? '';
        if (model) lastModel = model;
        const usage = msg.usage ?? {};
        const inputTokens = usage.input_tokens ?? 0;
        const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        const outputTokens: number = usage.output_tokens ?? 0;
        totalTokens += inputTokens + cacheWriteTokens + cacheReadTokens + outputTokens;
        totalCost += estimateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);

        const content: any[] = msg.content ?? [];
        for (const block of content) {
          if (block.type === 'tool_use') {
            const name: string = block.name ?? 'unknown';
            toolUsage[name] = (toolUsage[name] ?? 0) + 1;
          }
        }
      }
    });

    sessions.push({
      sessionId,
      firstTimestamp: firstTs ? new Date(firstTs).toISOString() : '',
      lastTimestamp: lastTs ? new Date(lastTs).toISOString() : '',
      messageCount,
      totalTokens,
      totalCost,
      model: lastModel,
      toolUsage,
      gitBranch,
    });
  }

  return sessions.sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp));
}

export async function getTokenLog(): Promise<TokenLogEntry[]> {
  const { tokenLogPath } = await getAppConfig();
  const raw = await readJSONL<TokenLogEntry>(tokenLogPath);
  if (raw.length === 0) return raw;

  // Token-log stores CUMULATIVE session totals. Many consecutive entries are
  // identical (multiple hooks fire on same turn). Deduplicate first, then diff.
  const deduped: TokenLogEntry[] = [];
  for (const entry of raw) {
    const prev = deduped[deduped.length - 1];
    if (prev &&
        prev.input_tokens === entry.input_tokens &&
        prev.output_tokens === entry.output_tokens &&
        prev.cached_tokens === entry.cached_tokens) {
      // Skip duplicate — keep the later timestamp and any updated fields
      deduped[deduped.length - 1] = { ...prev, ...entry };
      continue;
    }
    deduped.push(entry);
  }

  const result: TokenLogEntry[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const cur = deduped[i];
    const prev = deduped[i - 1];

    const inputDelta   = Math.max(0, (cur.input_tokens   ?? 0) - (prev?.input_tokens   ?? 0));
    const outputDelta  = Math.max(0, (cur.output_tokens  ?? 0) - (prev?.output_tokens  ?? 0));
    const cacheDelta   = Math.max(0, (cur.cached_tokens  ?? 0) - (prev?.cached_tokens  ?? 0));

    const incrementalCost = computeIncrementalCost(cur.model, inputDelta, outputDelta, cacheDelta);

    result.push({
      ...cur,
      input_tokens:  inputDelta,
      output_tokens: outputDelta,
      cached_tokens: cacheDelta,
      cost_usd:      incrementalCost,
    });
  }

  return result;
}

export async function getLiveUsage(): Promise<LiveUsage> {
  const { usageCachePath } = await getAppConfig();
  const fallback: LiveUsage = {
    ts: new Date().toISOString(),
    fiveHour: 0,
    sevenDay: 0,
    sevenDaySonnet: 0,
    fiveHourResetsAt: '',
    sevenDayResetsAt: '',
    source: 'unavailable',
  };
  try {
    const content = await fs.readFile(usageCachePath, 'utf-8');
    const parsed = JSON.parse(content);
    // Null-coalesce all numeric fields in case the cache has null values
    return {
      ts: parsed.ts ?? fallback.ts,
      fiveHour: parsed.fiveHour ?? 0,
      sevenDay: parsed.sevenDay ?? 0,
      sevenDaySonnet: parsed.overage_pct ?? parsed.sevenDaySonnet ?? 0,
      fiveHourResetsAt: parsed.fiveHourResetsAt ?? '',
      sevenDayResetsAt: parsed.sevenDayResetsAt ?? '',
      source: parsed.source ?? 'cache',
    };
  } catch {
    return fallback;
  }
}

export async function getActivity(): Promise<ActivityData> {
  const [history, costs] = await Promise.all([getHistory(), getCosts()]);

  const daily: Record<string, { messages: number; sessions: number; tokens: number }> = {};
  const hourly: Record<string, number> = {};
  const sessionsByDay: Record<string, Set<string>> = {};

  for (const entry of history) {
    const d = new Date(entry.timestamp);
    const dateKey = d.toISOString().slice(0, 10);
    const hourKey = String(d.getHours());

    if (!daily[dateKey]) daily[dateKey] = { messages: 0, sessions: 0, tokens: 0 };
    daily[dateKey].messages += 1;
    hourly[hourKey] = (hourly[hourKey] ?? 0) + 1;

    if (entry.sessionId) {
      if (!sessionsByDay[dateKey]) sessionsByDay[dateKey] = new Set();
      sessionsByDay[dateKey].add(entry.sessionId);
    }
  }

  for (const entry of costs) {
    const dateKey = entry.timestamp.slice(0, 10);
    if (!daily[dateKey]) daily[dateKey] = { messages: 0, sessions: 0, tokens: 0 };
    daily[dateKey].tokens += (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0);
  }

  for (const [day, sessions] of Object.entries(sessionsByDay)) {
    if (daily[day]) daily[day].sessions = sessions.size;
  }

  // Streak calculation
  const activeDays = Object.keys(daily).sort();
  const today = new Date().toISOString().slice(0, 10);
  let currentStreak = 0;
  let longestStreak = 0;
  let runLen = 0;

  for (let i = 0; i < activeDays.length; i++) {
    if (i === 0) {
      runLen = 1;
    } else {
      const prev = activeDays[i - 1];
      const curr = activeDays[i];
      const diff =
        (new Date(curr).getTime() - new Date(prev).getTime()) / 86400000;
      runLen = diff === 1 ? runLen + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, runLen);
  }

  // Current streak: consecutive days ending today or yesterday
  currentStreak = 0;
  for (let i = activeDays.length - 1; i >= 0; i--) {
    const daysAgo = Math.round(
      (new Date(today).getTime() - new Date(activeDays[i]).getTime()) / 86400000
    );
    if (daysAgo === currentStreak) {
      currentStreak += 1;
    } else {
      break;
    }
  }

  return { daily, hourly, streak: { current: currentStreak, longest: longestStreak } };
}

// Tool category mapping
const TOOL_CATEGORIES: Record<string, string> = {
  Read: 'filesystem',
  Write: 'filesystem',
  Edit: 'filesystem',
  Glob: 'filesystem',
  Grep: 'filesystem',
  Bash: 'execution',
  Agent: 'orchestration',
  Task: 'orchestration',
  TodoWrite: 'orchestration',
  TodoRead: 'orchestration',
  WebSearch: 'web',
  WebFetch: 'web',
  NotebookRead: 'notebook',
  NotebookEdit: 'notebook',
  Skill: 'skills',
  ToolSearch: 'meta',
};

function categorize(tool: string): string {
  if (TOOL_CATEGORIES[tool]) return TOOL_CATEGORIES[tool];
  if (tool.startsWith('mcp__')) return 'mcp';
  if (tool.toLowerCase().includes('browser')) return 'browser';
  return 'other';
}

export async function getToolUsage(): Promise<ToolUsageEntry[]> {
  return withIndexedCache('tool-usage', async (index) => {
    const toolCounts: Record<string, { count: number; errorCount: number; tokens: number }> = {};
    const toolUseIdToName: Record<string, string> = {};

    function handleEntry(entry: any) {
      if (entry.type === 'assistant') {
        const msg = entry.message;
        if (!msg) return;

        const content: any[] = msg.content ?? [];
        const toolUseBlocks = content.filter((block: any) => block?.type === 'tool_use');
        if (toolUseBlocks.length === 0) return;

        const usage = msg.usage ?? {};
        const turnTokens =
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        const tokensPerTool = Math.round(turnTokens / toolUseBlocks.length);

        for (const block of toolUseBlocks) {
          const toolName: string = block.name ?? 'unknown';
          if (!toolCounts[toolName]) {
            toolCounts[toolName] = { count: 0, errorCount: 0, tokens: 0 };
          }
          toolCounts[toolName].count += 1;
          toolCounts[toolName].tokens += tokensPerTool;
          if (block.id) toolUseIdToName[block.id] = toolName;
        }
      }

      if (entry.type === 'user') {
        const content: any[] = entry.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'tool_result' && block.is_error) {
            const toolName =
              block.tool_use_id && toolUseIdToName[block.tool_use_id]
                ? toolUseIdToName[block.tool_use_id]
                : 'unknown';
            if (!toolCounts[toolName]) {
              toolCounts[toolName] = { count: 0, errorCount: 0, tokens: 0 };
            }
            toolCounts[toolName].errorCount += 1;
          }
        }
      }
    }

    for (const sessionFile of index.sessionFiles) {
      await parseJSONLStream(sessionFile.filePath, handleEntry);
    }

    return Object.entries(toolCounts)
      .map(([tool, data]) => ({
        tool,
        category: categorize(tool),
        count: data.count,
        tokens: data.tokens,
        errorCount: data.errorCount,
      }))
      .sort((a, b) => b.count - a.count);
  });
}

// ── Session Conversation ──────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  model?: string;
}

export async function getSessionConversation(sessionId: string): Promise<ConversationTurn[]> {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  let sessionFilePath: string | null = null;

  // Search for the session file across all project dirs
  try {
    const projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const project of projectEntries) {
      if (!project.isDirectory()) continue;
      const candidate = path.join(projectsDir, project.name, `${sessionId}.jsonl`);
      try {
        await fs.access(candidate);
        sessionFilePath = candidate;
        break;
      } catch {
        // not in this project
      }
    }
  } catch {
    return [];
  }

  if (!sessionFilePath) return [];

  const turns: ConversationTurn[] = [];

  await parseJSONLStream(sessionFilePath, (entry: any) => {
    if (!entry.type || !entry.message) return;

    const timestamp = entry.timestamp ?? '';

    if (entry.type === 'user') {
      const msg = entry.message;
      const contentArr: any[] = Array.isArray(msg.content) ? msg.content : [];

      // Gather text blocks and tool_result blocks
      const textParts: string[] = [];
      for (const block of contentArr) {
        if (block.type === 'tool_result') {
          // tool result — extract text content
          let resultText = '';
          if (typeof block.content === 'string') {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text ?? '')
              .join('');
          }
          if (resultText) {
            turns.push({
              role: 'tool',
              content: resultText.slice(0, 500) + (resultText.length > 500 ? '…' : ''),
              timestamp,
            });
          }
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        }
      }

      // Plain string content
      if (typeof msg.content === 'string' && msg.content.trim()) {
        textParts.push(msg.content);
      }

      if (textParts.length > 0) {
        const combined = textParts.join('\n').trim();
        if (combined) {
          turns.push({ role: 'user', content: combined, timestamp });
        }
      }
    } else if (entry.type === 'assistant') {
      const msg = entry.message;
      if (!msg) return;
      const model: string = msg.model ?? '';
      const contentArr: any[] = Array.isArray(msg.content) ? msg.content : [];
      const textParts: string[] = [];
      const toolNames: string[] = [];

      for (const block of contentArr) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'tool_use' && block.name) {
          toolNames.push(block.name);
        }
      }

      if (textParts.length > 0) {
        turns.push({
          role: 'assistant',
          content: textParts.join('\n').trim(),
          timestamp,
          model,
        });
      }

      // Emit tool_use entries
      for (const toolName of toolNames) {
        turns.push({
          role: 'tool',
          content: '',
          timestamp,
          toolName,
          model,
        });
      }
    }
  });

  // Return most recent 200 turns
  return turns.slice(-200);
}

// ── Claude Code Status ────────────────────────────────────────────────────────

export interface ClaudeCodeStatus {
  active: boolean;
  activeSessions: number;
  lastActivity: string | null;
}

export async function getClaudeCodeStatus(): Promise<ClaudeCodeStatus> {
  const { execSync } = await import('child_process');
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  // Check for active claude process
  let processActive = false;
  try {
    const result = execSync(
      "pgrep -f 'claude' | xargs -I{} ps -p {} -o args= 2>/dev/null | grep -v 'Claude Usage' | head -1",
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    processActive = result.length > 0;
  } catch {
    // No process found — pgrep exits non-zero when no match
  }

  // Check session.jsonl files modified in the last 60 seconds
  let activeSessions = 0;
  let latestMtime: Date | null = null;

  try {
    const projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
    await Promise.all(
      projectEntries
        .filter((e) => e.isDirectory())
        .map(async (proj) => {
          const projPath = path.join(projectsDir, proj.name);
          let files: string[] = [];
          try {
            files = (await fs.readdir(projPath))
              .filter((f) => f.endsWith('.jsonl'))
              .map((f) => path.join(projPath, f));
          } catch {
            return;
          }
          await Promise.all(
            files.map(async (f) => {
              try {
                const stat = await fs.stat(f);
                if (!latestMtime || stat.mtime > latestMtime) {
                  latestMtime = stat.mtime;
                }
                if (Date.now() - stat.mtime.getTime() < 60_000) {
                  activeSessions += 1;
                }
              } catch {}
            })
          );
        })
    );
  } catch {}

  const active = processActive || activeSessions > 0;

  return {
    active,
    activeSessions,
    lastActivity: latestMtime ? (latestMtime as Date).toISOString() : null,
  };
}
