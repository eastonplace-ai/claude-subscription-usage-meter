'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Hook {
  type?: string;
  command?: string;
  hooks?: Array<{ type: string; command?: string; script?: string }>;
  [key: string]: unknown;
}

interface Plugin {
  name?: string;
  type?: string;
  [key: string]: unknown;
}

interface Settings {
  model?: string;
  largeContextModel?: string;
  smallFastModel?: string;
  effort?: string;
  env?: Record<string, string>;
  hooks?: Record<string, Hook[]>;
  plugins?: Plugin[] | Record<string, unknown>;
  [key: string]: unknown;
}

// ── Descriptions ───────────────────────────────────────────────────────────────

const HOOK_DESCRIPTIONS: Record<string, string> = {
  PreToolUse: 'Fires before Claude reads, edits, or runs any tool. Can inspect the action and block it entirely — used here to prevent re-reading files already in context.',
  PostToolUse: 'Fires after Claude finishes using a tool. Used for logging, auditing, or triggering follow-up actions based on what just ran.',
  PreCompact: 'Fires when your conversation hits ~80% context capacity, just before Claude compresses history. Captures what you were working on so nothing is lost across the compaction boundary.',
  Stop: 'Fires when Claude finishes a task or the session ends cleanly. Used for final cleanup, cost logging, and writing session summaries to the vault.',
  UserPromptSubmit: 'Fires every time you send a message — before Claude even sees it. Used to inject relevant vault context, log the turn, and check whether a sprint report is due.',
  SessionStart: 'Fires on session start, /clear, and post-compaction restart. Loads your identity profile, active project context, and recent session notes from the Obsidian vault so Claude starts with full context.',
  Notification: 'Fires when Claude wants to alert you (e.g. long task completed). Can be routed to Telegram or desktop notifications.',
  SubagentStop: 'Fires when a spawned background sub-agent finishes. Used to collect results, log agent token usage, and bubble up status.',
};

// ── Per-script descriptions (replaces generic "Runs a Node.js script: X.js") ──
const SCRIPT_DESCRIPTIONS: Record<string, string> = {
  'obsidian-session-start.js': 'Loads your Obsidian vault into context — reads your identity profile, the active WIP file, and the vault index. Injects up to ~2KB of structured context so Claude knows your projects, preferences, and current blockers without you re-explaining. Also logs a session-start event to Supabase with your current rate limit usage.',
  'obsidian-turn-lookup.js': 'Fires on every message. Keyword-matches your prompt to vault notes (e.g. "dashboard" → dashboard.md), traverses wikilinks up to 2 hops deep, and injects the most relevant snippets as context. Also runs a Khoj semantic search for anything not caught by keywords. Logs injection size to Supabase. Target: under 80ms.',
  'obsidian-turn-noter.js': 'Fires on every message. Tracks turn count and every 4 turns appends a timestamped note to your daily session log in the vault (ops/sessions/YYYY-MM-DD.md). Creates a running breadcrumb trail of what you worked on during the session. Also logs the event to Supabase. Target: under 30ms.',
  'obsidian-precompact.js': 'Fires just before context compaction. Reads the last 200 lines of the session transcript, extracts what you were working on and which tools ran, and writes a structured snapshot to the vault. Also overwrites active.md with your current state so the very next session start picks it up immediately.',
  'pm-report-hook.js': 'Fires on every message. Every 10 turns it generates a Sprint Report (via Haiku) covering what shipped, what got worse, token spend, and action backlog — saved to the vault and pinged to Telegram. Every 50 turns it generates a full Sprint Retrospective instead. Also runs vault maintenance: adds missing descriptions to notes and flags orphaned pages.',
  'keyword-router.js': 'Fires on every message. Pattern-matches your prompt against configured keywords and injects a routing tag so the parent agent knows which sub-agent should handle the request.',
  'fetch-live-usage.js': 'Utility called by other hooks — not a hook itself. Reads your current Claude rate limit usage (5-hour and 7-day windows) from Supabase and returns the percentages so they get attached to every log entry.',
};

function hookEventDescription(event: string): string {
  if (HOOK_DESCRIPTIONS[event]) return HOOK_DESCRIPTIONS[event];
  const words = event.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return `Runs on the ${words} event.`;
}

function describeCommand(cmd: string): string {
  const nodeMatch = cmd.match(/node\s+['"]?([^\s'"]+\.js)/i);
  if (nodeMatch) {
    const scriptName = nodeMatch[1].split('/').pop() ?? nodeMatch[1];
    if (SCRIPT_DESCRIPTIONS[scriptName]) return SCRIPT_DESCRIPTIONS[scriptName];
    return `Runs a Node.js script: ${scriptName}`;
  }
  const pythonMatch = cmd.match(/python[3]?\s+['"]?([^\s'"]+\.py)/i);
  if (pythonMatch) {
    const scriptName = pythonMatch[1].split('/').pop() ?? pythonMatch[1];
    return `Runs a Python script: ${scriptName}`;
  }
  if (cmd.startsWith('bash ') || cmd.startsWith('sh ')) return 'Runs a shell script.';
  if (cmd.includes('|')) return 'Runs a shell pipeline.';
  return '';
}

const ENV_DESCRIPTIONS: Record<string, string> = {
  SUPABASE_URL: 'The Supabase project URL — where your agent token logs, vault metrics, and rate limit cache are stored.',
  SUPABASE_SERVICE_ROLE_KEY: 'Service role secret for Supabase — grants full DB access, bypassing row-level security. Used by hooks to write token logs and read rate limit data.',
  ANTHROPIC_API_KEY: 'Your Anthropic API key. Note: Claude Max subscription uses an OAuth token from Keychain instead — this is only needed for standalone scripts.',
  TELEGRAM_BOT_TOKEN: 'The bot token for your Telegram bot. Used by pm-report-hook to ping you when sprint reports are generated.',
};

function envDescription(key: string): string {
  if (ENV_DESCRIPTIONS[key]) return ENV_DESCRIPTIONS[key];
  if (/API[_-]?KEY/i.test(key)) return 'API authentication key';
  if (/TOKEN/i.test(key)) return 'Authentication token';
  return '';
}

const PLUGIN_DESCRIPTIONS: Record<string, string> = {
  'obsidian-skills': 'Obsidian vault integration',
  'agent-sdk-dev': 'Agent SDK development tools',
  'skill-creator': 'Create and manage custom skills',
  'data': 'Data analysis and profiling tools',
  'ui-ux-pro-max': 'Advanced UI/UX design assistance',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const SECRET_PATTERN = /key|token|secret|password|credential|auth|api[_\-]?key/i;

function looksLikeSecret(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

function formatModel(model: string): string {
  if (!model) return '—';
  return model;
}

function modelShortName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return 'Unknown';
}

function modelColor(model: string): string {
  if (model.includes('opus')) return '#5B9BF6';
  if (model.includes('sonnet')) return '#AF52DE';
  if (model.includes('haiku')) return '#4ECDC4';
  return '#666666';
}

function hookEventLabel(event: string): string {
  return event
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toUpperCase();
}

function extractHookCommand(hook: Hook): string {
  if (hook.command) return hook.command;
  if (typeof hook === 'string') return hook as unknown as string;
  if (hook.hooks && hook.hooks.length > 0) {
    const sub = hook.hooks[0];
    return sub.command ?? sub.script ?? JSON.stringify(sub);
  }
  return JSON.stringify(hook);
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-nothing bg-nothing-surface2 animate-pulse ${className}`} />
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function Section({
  title,
  badge,
  delay,
  children,
}: {
  title: string;
  badge?: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <Card delay={delay}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {badge && <Badge variant="estimated">{badge}</Badge>}
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

// ── Env var row ────────────────────────────────────────────────────────────────

function EnvRow({ envKey, value }: { envKey: string; value: string }) {
  const isSecret = looksLikeSecret(envKey);
  const [revealed, setRevealed] = useState(false);
  const desc = envDescription(envKey);

  const displayValue = isSecret && !revealed
    ? '••••••••••••'
    : value;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-nothing-border last:border-b-0 hover:bg-nothing-surface2/40 transition-colors">
      <div className="w-[220px] shrink-0">
        <span className="font-mono text-[10px] text-nothing-text-muted truncate block">
          {envKey}
        </span>
        {desc && (
          <span className="font-mono text-[8px] text-nothing-text-dim truncate block mt-0.5">
            {desc}
          </span>
        )}
      </div>
      <span className="font-mono text-[10px] text-nothing-text flex-1 truncate">
        {displayValue}
      </span>
      {isSecret && (
        <button
          onClick={() => setRevealed((r) => !r)}
          className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim hover:text-nothing-text-muted transition-colors shrink-0 border border-nothing-border rounded px-1.5 py-0.5"
        >
          {revealed ? 'hide' : 'reveal'}
        </button>
      )}
    </div>
  );
}

// ── Hook row ──────────────────────────────────────────────────────────────────

function HookRow({ event, hooks }: { event: string; hooks: Hook[] }) {
  const desc = hookEventDescription(event);

  return (
    <div className="px-4 py-3 border-b border-nothing-border last:border-b-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-nothing-text-secondary">
          {hookEventLabel(event)}
        </span>
        <Badge variant="live" showDot>
          {hooks.length} hook{hooks.length !== 1 ? 's' : ''}
        </Badge>
      </div>
      <p className="font-mono text-[8px] text-nothing-text-dim mb-2 leading-relaxed">
        {desc}
      </p>
      <div className="space-y-1.5">
        {hooks.map((hook, i) => {
          const cmd = extractHookCommand(hook);
          const cmdDesc = describeCommand(cmd);
          return (
            <div key={i} className="rounded-nothing bg-nothing-surface2 border border-nothing-border overflow-hidden">
              <div className="font-mono text-[10px] text-nothing-text-muted px-2.5 py-1.5 truncate">
                {cmd}
              </div>
              {cmdDesc && (
                <div className="font-mono text-[8px] text-nothing-text-dim px-2.5 pb-1.5 border-t border-nothing-border/50">
                  {cmdDesc}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Plugin card ───────────────────────────────────────────────────────────────

function PluginCard({ name, type }: { name: string; type?: string }) {
  const desc = PLUGIN_DESCRIPTIONS[name];

  return (
    <div className="border border-nothing-border rounded-nothing p-3 bg-nothing-surface hover:border-nothing-border2 transition-colors">
      <p className="font-mono text-[10px] text-nothing-text truncate mb-1">{name}</p>
      {desc ? (
        <span className="font-mono text-[8px] text-nothing-text-dim leading-relaxed block">
          {desc}
        </span>
      ) : type ? (
        <span className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim">
          {type}
        </span>
      ) : null}
    </div>
  );
}

// ── Workflow Configuration data ────────────────────────────────────────────────

const WORKFLOW_CONFIG = {
  executionModel: [
    { role: 'Parent (Opus)', effort: 'low', desc: 'Plans, delegates, QA, communicates. Never executes what a sub-agent can do.' },
    { role: 'Sub-agents (code)', effort: 'medium', desc: 'Sonnet — all code execution. Spawn aggressively, parallelize when possible. Always run_in_background unless output needed.' },
    { role: 'Sub-agents (research)', effort: 'high', desc: 'Haiku — reading, research, querying. On any task: lay out todo list, delegate each item, QA output, send back with specific fixes.' },
  ],
  agentTeam: [
    { name: 'Agent 1', model: 'haiku-4.5', effort: 'high', role: 'Configured in .claude/agents/' },
    { name: 'Agent 2', model: 'sonnet-4.6', effort: 'medium', role: 'Configured in .claude/agents/' },
    { name: 'Agent 3', model: 'sonnet-4.6', effort: 'medium', role: 'Configured in .claude/agents/' },
  ],
  workflowRules: [
    'Work tasks end-to-end in one pass.',
    'Fewer turns = better. Bundle work, don\'t drip-feed updates.',
    'Stay responsive while agents run. Summarize results when done.',
    'Browser tasks: browser-use MCP only — no Playwright or devtools.',
    'Skills: check skills.md before doing anything manually.',
    'Docs on-demand: never load large doc outputs into context. Use grep + head to stay surgical.',
    'Adding a skill: update skills.md, relevant vault note(s), and obsidian-turn-lookup.js regex.',
  ],
  auth: [
    { key: 'Subscription', value: 'Claude Max — no separate ANTHROPIC_API_KEY' },
    { key: 'Token source', value: 'macOS Keychain: security find-generic-password -s "Claude Code-credentials" -w' },
    { key: 'Token usage', value: 'Parse claudeAiOauth.accessToken → Authorization: Bearer <token> + anthropic-beta: oauth-2025-04-20' },
  ],
};

function modelEffortColor(effort: string): string {
  if (effort === 'low') return '#4A9E5C';
  if (effort === 'medium') return '#AF52DE';
  if (effort === 'high') return '#5B9BF6';
  return '#666';
}

function WorkflowConfigSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Configuration</CardTitle>
        <Badge variant="estimated">CLAUDE.md</Badge>
      </CardHeader>
      <CardContent className="p-0">

        {/* Execution Model */}
        <div className="px-4 pt-3 pb-2 border-b border-nothing-border">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-dim block mb-2">
            Execution Model
          </span>
          <div className="space-y-2">
            {WORKFLOW_CONFIG.executionModel.map((row) => (
              <div key={row.role} className="flex gap-3 items-start">
                <div className="shrink-0 w-[148px]">
                  <span className="font-mono text-[9px] text-nothing-text-secondary block truncate">{row.role}</span>
                  <span
                    className="font-mono text-[8px] uppercase tracking-wider block mt-0.5"
                    style={{ color: modelEffortColor(row.effort) }}
                  >
                    {row.effort} effort
                  </span>
                </div>
                <span className="font-mono text-[9px] text-nothing-text-dim leading-relaxed flex-1">{row.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Team */}
        <div className="px-4 pt-3 pb-2 border-b border-nothing-border">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-dim block mb-2">
            Agent Team
          </span>
          <div className="grid grid-cols-3 gap-2">
            {WORKFLOW_CONFIG.agentTeam.map((agent) => (
              <div
                key={agent.name}
                className="rounded-nothing border border-nothing-border bg-nothing-surface p-2.5 hover:border-nothing-border2 transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-[10px] text-nothing-text">{agent.name}</span>
                  <span
                    className="font-mono text-[7px] uppercase tracking-wider"
                    style={{ color: modelEffortColor(agent.effort) }}
                  >
                    {agent.effort}
                  </span>
                </div>
                <span className="font-mono text-[8px] text-nothing-text-dim block mb-1">{agent.model}</span>
                <span className="font-mono text-[8px] text-nothing-text-dim/70 block leading-relaxed">{agent.role}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Workflow Rules */}
        <div className="px-4 pt-3 pb-2 border-b border-nothing-border">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-dim block mb-2">
            Workflow Rules
          </span>
          <div className="space-y-1.5">
            {WORKFLOW_CONFIG.workflowRules.map((rule, i) => (
              <div key={i} className="flex gap-2 items-start">
                <span className="font-mono text-[8px] text-nothing-text-dim/40 shrink-0 mt-0.5 w-4 text-right">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[9px] text-nothing-text-dim leading-relaxed">{rule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Auth */}
        <div className="px-4 pt-3 pb-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nothing-text-dim block mb-2">
            Auth Pattern
          </span>
          <div className="space-y-2">
            {WORKFLOW_CONFIG.auth.map((row) => (
              <div key={row.key} className="flex gap-3 items-start">
                <span className="font-mono text-[9px] text-nothing-text-muted shrink-0 w-[112px]">{row.key}</span>
                <span className="font-mono text-[9px] text-nothing-text-dim leading-relaxed flex-1 break-all">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

// ── Menubar Settings Types ─────────────────────────────────────────────────────

interface MenubarSettings {
  enabled: boolean;
  showInMenubar: boolean;
  showFiveHour: boolean;
  showSevenDay: boolean;
  showSonnet: boolean;
  showCost: boolean;
  refreshInterval: number;
}

const MENUBAR_DEFAULTS: MenubarSettings = {
  enabled: true,
  showInMenubar: true,
  showFiveHour: true,
  showSevenDay: true,
  showSonnet: true,
  showCost: true,
  refreshInterval: 60,
};

// ── Menubar Settings Section ───────────────────────────────────────────────────

function MenubarSettingsSection({
  settings,
  onSave,
  saving,
}: {
  settings: MenubarSettings;
  onSave: (next: MenubarSettings) => void;
  saving: boolean;
}) {
  const toggle = (key: keyof MenubarSettings) => {
    onSave({ ...settings, [key]: !settings[key] });
  };

  const setRefresh = (val: number) => {
    onSave({ ...settings, refreshInterval: val });
  };

  const ToggleRow = ({
    label,
    description,
    field,
    disabled,
  }: {
    label: string;
    description?: string;
    field: keyof MenubarSettings;
    disabled?: boolean;
  }) => {
    const checked = !!settings[field];
    return (
      <div
        className={`flex items-center justify-between px-4 py-2.5 border-b border-nothing-border last:border-b-0 transition-colors ${disabled ? 'opacity-40' : 'hover:bg-nothing-surface2/40'}`}
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] text-nothing-text">{label}</span>
          {description && (
            <span className="font-mono text-[8px] text-nothing-text-dim">{description}</span>
          )}
        </div>
        <button
          disabled={disabled}
          onClick={() => !disabled && toggle(field)}
          className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border transition-colors duration-150 focus:outline-none ${
            checked
              ? 'bg-nothing-green border-nothing-green/60'
              : 'bg-nothing-surface2 border-nothing-border2'
          } ${disabled ? 'cursor-not-allowed' : ''}`}
          aria-checked={checked}
          role="switch"
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-nothing-text shadow-sm transform transition-transform duration-150 mt-0.5 ${
              checked ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Menu Bar Widget</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={settings.enabled ? 'live' : 'estimated'}>
            {settings.enabled ? 'ENABLED' : 'DISABLED'}
          </Badge>
          {saving && (
            <span className="font-mono text-[8px] uppercase tracking-wider text-nothing-text-dim animate-pulse">
              saving…
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ToggleRow
          label="Enable Menu Bar"
          description="Master toggle — shows or hides the menu bar widget entirely"
          field="enabled"
        />
        <ToggleRow
          label="Show 5-Hour Usage"
          description="Display current 5-hour rate limit window"
          field="showFiveHour"
          disabled={!settings.enabled}
        />
        <ToggleRow
          label="Show 7-Day Usage"
          description="Display rolling 7-day usage percentage"
          field="showSevenDay"
          disabled={!settings.enabled}
        />
        <ToggleRow
          label="Show Sonnet Weekly"
          description="Display Sonnet-specific weekly token count"
          field="showSonnet"
          disabled={!settings.enabled}
        />
        <ToggleRow
          label="Show Today's Cost"
          description="Display estimated spend for the current day"
          field="showCost"
          disabled={!settings.enabled}
        />

        {/* Refresh interval */}
        <div
          className={`flex items-center justify-between px-4 py-3 transition-colors ${!settings.enabled ? 'opacity-40' : 'hover:bg-nothing-surface2/40'}`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] text-nothing-text">Refresh Interval</span>
            <span className="font-mono text-[8px] text-nothing-text-dim">
              How often the widget polls for new data
            </span>
          </div>
          <select
            disabled={!settings.enabled}
            value={settings.refreshInterval}
            onChange={(e) => setRefresh(Number(e.target.value))}
            className="font-mono text-[10px] text-nothing-text bg-nothing-surface2 border border-nothing-border rounded-nothing px-2 py-1 focus:outline-none focus:border-nothing-border2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value={30}>30s</option>
            <option value={60}>60s</option>
            <option value={120}>120s</option>
            <option value={300}>300s</option>
          </select>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [menubarSettings, setMenubarSettings] = useState<MenubarSettings>(MENUBAR_DEFAULTS);
  const [menubarSaving, setMenubarSaving] = useState(false);

  const saveMenubarSettings = useCallback(async (next: MenubarSettings) => {
    setMenubarSettings(next);
    setMenubarSaving(true);
    try {
      await fetch('/api/menubar-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch (e) {
      console.error('Failed to save menubar settings', e);
    } finally {
      setMenubarSaving(false);
    }
  }, []);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const [settingsRes, menubarRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/menubar-settings'),
        ]);
        if (settingsRes.ok) setSettings(await settingsRes.json());
        if (menubarRes.ok) setMenubarSettings(await menubarRes.json());
      } catch (e) {
        console.error('Failed to fetch settings', e);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-16" />
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-nothing-text-muted">
          Settings not found
        </span>
        <span className="font-mono text-[9px] text-nothing-text-dim">
          Could not load settings.json
        </span>
      </div>
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const model = settings.model ?? '';
  const effort = settings.effort ?? '';
  const envEntries = Object.entries(settings.env ?? {});
  const hookEntries = Object.entries(settings.hooks ?? {});

  let pluginList: Array<{ name: string; type?: string }> = [];
  if (Array.isArray(settings.plugins)) {
    pluginList = settings.plugins.map((p) => ({
      name: String(p.name ?? p.type ?? JSON.stringify(p)),
      type: p.type ? String(p.type) : undefined,
    }));
  } else if (settings.plugins && typeof settings.plugins === 'object') {
    pluginList = Object.entries(settings.plugins).map(([k, v]) => ({
      name: k,
      type: typeof v === 'string' ? v : undefined,
    }));
  }

  const color = modelColor(model);
  const shortName = modelShortName(model);

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07 } },
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-4 max-w-3xl"
    >
      {/* Appearance (placeholder) */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <Badge variant="estimated">Info</Badge>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-[10px] text-nothing-text-muted">
              Light/dark mode toggle is in the header bar.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Menu Bar Widget */}
      <motion.div variants={fadeUp}>
        <MenubarSettingsSection
          settings={menubarSettings}
          onSave={saveMenubarSettings}
          saving={menubarSaving}
        />
      </motion.div>

      {/* Model section */}
      <motion.div variants={fadeUp}>
        <Card variant="accent" accentColor={color}>
          <CardHeader>
            <CardTitle>Model</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="model">{shortName}</Badge>
              {effort && (
                <Badge variant="estimated">{effort} effort</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 mb-1">
              <span
                className="font-mono font-bold text-[24px] leading-none"
                style={{ color }}
              >
                {formatModel(model) || '—'}
              </span>
            </div>
            <p className="font-mono text-[8px] text-nothing-text-dim mb-3">
              The AI model Claude uses for your conversations
            </p>
            {(settings.largeContextModel || settings.smallFastModel || effort) && (
              <div className="mt-3 pt-3 border-t border-nothing-border space-y-2">
                {settings.largeContextModel && (
                  <div className="flex gap-3 items-start">
                    <div className="w-32 shrink-0">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-dim block">
                        Large Context
                      </span>
                      <span className="font-mono text-[8px] text-nothing-text-dim/60 block mt-0.5">
                        For very long conversations
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-nothing-text-muted">
                      {String(settings.largeContextModel)}
                    </span>
                  </div>
                )}
                {settings.smallFastModel && (
                  <div className="flex gap-3 items-start">
                    <div className="w-32 shrink-0">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-dim block">
                        Small Fast
                      </span>
                      <span className="font-mono text-[8px] text-nothing-text-dim/60 block mt-0.5">
                        For simple sub-tasks
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-nothing-text-muted">
                      {String(settings.smallFastModel)}
                    </span>
                  </div>
                )}
                {effort && (
                  <div className="flex gap-3 items-start">
                    <div className="w-32 shrink-0">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-nothing-text-dim block">
                        Effort
                      </span>
                      <span className="font-mono text-[8px] text-nothing-text-dim/60 block mt-0.5">
                        Low = fast, high = thorough
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-nothing-text-muted">
                      {effort}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Environment Variables */}
      {envEntries.length > 0 && (
        <motion.div variants={fadeUp}>
          <Section title="Environment Variables" badge={`${envEntries.length} vars`} delay={0}>
            {envEntries.map(([k, v]) => (
              <EnvRow key={k} envKey={k} value={String(v)} />
            ))}
          </Section>
        </motion.div>
      )}

      {/* Hooks */}
      {hookEntries.length > 0 && (
        <motion.div variants={fadeUp}>
          <Section title="Hooks" badge={`${hookEntries.length} events`} delay={0}>
            {hookEntries.map(([event, hooks]) => (
              <HookRow key={event} event={event} hooks={hooks} />
            ))}
          </Section>
        </motion.div>
      )}

      {/* Plugins */}
      {pluginList.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Plugins</CardTitle>
              <Badge variant="purple">{pluginList.length} installed</Badge>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {pluginList.map((plugin) => (
                  <PluginCard key={plugin.name} name={plugin.name} type={plugin.type} />
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Workflow Configuration */}
      <motion.div variants={fadeUp}>
        <WorkflowConfigSection />
      </motion.div>

      {/* Raw keys not covered above */}
      {(() => {
        const known = new Set(['model', 'largeContextModel', 'smallFastModel', 'effort', 'env', 'hooks', 'plugins']);
        const extra = Object.entries(settings).filter(([k]) => !known.has(k));
        if (extra.length === 0) return null;
        return (
          <motion.div variants={fadeUp}>
            <Section title="Other Settings" delay={0}>
              {extra.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-start gap-3 px-4 py-2.5 border-b border-nothing-border last:border-b-0"
                >
                  <span className="font-mono text-[10px] text-nothing-text-muted w-[200px] shrink-0">
                    {k}
                  </span>
                  <span className="font-mono text-[10px] text-nothing-text-secondary flex-1 break-all">
                    {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                  </span>
                </div>
              ))}
            </Section>
          </motion.div>
        );
      })()}
    </motion.div>
  );
}
